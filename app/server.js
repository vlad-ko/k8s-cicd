// Container entrypoint for Webo's Money World.
//
// The application was written for Vercel: static files served by the platform's
// CDN, `api/*.js` executed by Vercel's Node function runtime, and the security
// headers declared in `vercel.json`. Kubernetes provides none of that, so this
// file supplies the three things the platform used to:
//
//   1. a static file server, over an explicit allowlist
//   2. a request/response shim that lets the Vercel handlers run UNCHANGED
//   3. the `vercel.json` security headers, reapplied on every response
//
// The deliberate constraint is that `api/ask.js` and `api/progress.js` are not
// modified. They still run on Vercel from the same source; this only changes
// what invokes them. That is the portability claim the lab is built to make, and
// editing the handlers to suit Kubernetes would quietly void it.

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { URL } = require('node:url');

const ROOT = __dirname;
const PORT = parseInt(process.env.PORT || '8080', 10);

// Bodies are capped before buffering. The handlers apply their own, tighter
// limit from WEBO_MAX_BODY_BYTES; this is the cruder guard that stops an
// unbounded read from ever reaching them.
const MAX_BODY_BYTES = 1024 * 1024;

// ---------------------------------------------------------------------------
// Static allowlist
//
// An allowlist rather than "serve ROOT" because ROOT also contains api/, lib/
// server code, test/ and .env.example. A path-traversal guard alone would still
// happily serve lib/kv.js — enumerating what is public is the safer default.
// ---------------------------------------------------------------------------
const STATIC_FILES = new Set(['/index.html', '/styles.css', '/app.mjs']);
const STATIC_DIRS = ['/assets/', '/lessons/', '/vendor/'];
// lib/ is mixed: lesson-kit.mjs is a browser module, kv.js and util.js are
// server-side. Only the browser module is exposed.
const STATIC_EXACT = new Set(['/lib/lesson-kit.mjs']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

// Mirrors the `headers` block of vercel.json. On Vercel the platform applies
// these; here they would silently disappear, which is the kind of regression a
// migration quietly introduces and nobody notices until a pen test.
const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; " +
    "script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; form-action 'self'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
};

function applySecurityHeaders(res) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
}

// ---------------------------------------------------------------------------
// Vercel handler shim
//
// Vercel's Node runtime hands handlers a request already decorated with parsed
// `body` and `query`, and a response carrying Express-style `status()` and
// `json()`. Node's http gives none of those. Rather than rewrite the handlers,
// the same surface is reconstructed around them.
// ---------------------------------------------------------------------------
function decorateResponse(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (obj) => {
    // Only set the type if the handler has not already chosen one — ask.js sets
    // its own Content-Type before calling status().json().
    if (!res.hasHeader('Content-Type')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    res.end(JSON.stringify(obj));
    return res;
  };
  return res;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('body too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function decorateRequest(req, url) {
  req.query = Object.fromEntries(url.searchParams.entries());
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    const raw = await readBody(req);
    const type = String(req.headers['content-type'] || '');
    if (type.includes('application/json')) {
      // Matches Vercel: malformed JSON arrives as undefined rather than throwing,
      // and the handlers already treat a missing body as a 400.
      try {
        req.body = raw.length ? JSON.parse(raw.toString('utf8')) : undefined;
      } catch {
        req.body = undefined;
      }
    } else {
      req.body = raw.toString('utf8');
    }
  }
  return req;
}

// Loaded lazily so a handler that throws at require-time surfaces as a 500 on
// its own route rather than preventing the whole server from starting — the
// static site and health probes stay up either way.
function loadHandler(name) {
  // eslint-disable-next-line global-require
  return require(path.join(ROOT, 'api', name));
}

// ---------------------------------------------------------------------------
// Lab endpoints
//
// Not part of the Vercel app. These exist so the deployment's claims are
// verifiable from a browser rather than asserted:
//   version  - from package.json, so bumping it and redeploying is visible
//   build    - the Harness pipeline run that produced this image
//   instance - the pod name, which distinguishes canary from stable pods
// ---------------------------------------------------------------------------
const pkg = require(path.join(ROOT, 'package.json'));

function versionPayload() {
  return {
    application: 'webo-money-world',
    version: process.env.APP_VERSION || pkg.version || 'unknown',
    build: process.env.BUILD_ID || 'local',
    instance: os.hostname(),
  };
}

function isStaticPath(p) {
  if (STATIC_FILES.has(p) || STATIC_EXACT.has(p)) return true;
  return STATIC_DIRS.some((d) => p.startsWith(d));
}

async function serveStatic(res, pathname) {
  const filePath = path.join(ROOT, pathname);
  // Defence in depth: the allowlist should already prevent escaping ROOT, but a
  // decoded '..' must never resolve outside it.
  if (!filePath.startsWith(ROOT + path.sep)) {
    res.statusCode = 403;
    return res.end('Forbidden');
  }
  let data;
  try {
    data = await fsp.readFile(filePath);
  } catch {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('Not found');
  }
  res.setHeader('Content-Type', MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
  // Matches vercel.json: vendored, version-pinned assets are immutable.
  res.setHeader('Cache-Control', pathname.startsWith('/vendor/')
    ? 'public, max-age=31536000, immutable'
    : 'no-cache');
  return res.end(data);
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    res.statusCode = 400;
    return res.end('Bad request');
  }
  const pathname = decodeURIComponent(url.pathname);

  // Probes answer before security headers and any app logic, so a failure in
  // either cannot make a healthy pod look unhealthy and trigger a restart loop.
  if (pathname === '/healthz' || pathname === '/healthz/ready') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ status: 'ok' }));
  }

  applySecurityHeaders(res);

  if (pathname === '/api/version') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify(versionPayload()));
  }

  if (pathname === '/api/ask' || pathname === '/api/progress') {
    const file = pathname === '/api/ask' ? 'ask.js' : 'progress.js';
    decorateResponse(res);
    try {
      await decorateRequest(req, url);
      const handler = loadHandler(file);
      return await handler(req, res);
    } catch (err) {
      const code = err && err.statusCode === 413 ? 413 : 500;
      console.error(`[webo] ${file} failed:`, err && err.message);
      if (!res.headersSent) {
        res.statusCode = code;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
      }
      return res.end(JSON.stringify({ reply: 'Webo is having a little trouble right now!' }));
    }
  }

  if (pathname === '/') return serveStatic(res, '/index.html');
  if (isStaticPath(pathname)) return serveStatic(res, pathname);

  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  return res.end('Not found');
});

// Kubernetes sends SIGTERM and then waits. Closing the server lets in-flight
// requests drain instead of being cut off mid-rollout.
function shutdown(signal) {
  console.log(`[webo] ${signal} received, draining connections`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

if (require.main === module) {
  server.listen(PORT, () => {
    const v = versionPayload();
    console.log(`[webo] listening on :${PORT} version=${v.version} build=${v.build} instance=${v.instance}`);
    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn('[webo] ANTHROPIC_API_KEY not set — /api/ask will return its warming-up response');
    }
  });
}

module.exports = { server, versionPayload, isStaticPath, SECURITY_HEADERS };

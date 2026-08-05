// Webo's Money World - anonymous cross-device progress codes (Vercel Node function).
//
//   POST /api/progress  { progress: { lessons:[{id, completed}] } }  ->  { ok, code }
//   GET  /api/progress?code=XXXXXXXX                                  ->  { ok, progress }
//
// COPPA-SAFE BY DESIGN (this product targets under-13s; see issue #1):
//   - NO PII is ever accepted or stored. The server REBUILDS a clean record from a
//     strict whitelist (lesson ids + completed flags only) and ignores everything
//     else the client sends, so free-text / names / emails cannot be smuggled in.
//   - The "code" is a random, non-identifying string. It maps to a progress record
//     and reveals nothing about the child. No account, no login, no email.
//   - Records are size-capped and TTL'd (self-expiring), and writes/reads are
//     per-IP rate limited (reusing the same KV infra as /api/ask) to prevent abuse
//     of the store as free arbitrary storage.
// This is the "anonymous resume code" tier of issue #19; localStorage remains the
// default per-device store. No account-based sync until the COPPA flow lands (#1).

const { kvGet, kvSetNx, kvConfigured, limitOk } = require('../lib/kv');
const { clientIp } = require('../lib/util');

// Unambiguous alphabet (no 0/O/1/I/L) so a child or parent can read/type a code.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LEN = 8;

const TTL_DAYS = parseInt(process.env.WEBO_PROGRESS_TTL_DAYS || '90', 10);
const TTL_SECONDS = TTL_DAYS * 86400;
const RATE_MAX = parseInt(process.env.WEBO_PROGRESS_RATE_MAX || '30', 10);     // per-IP saves per window
const GET_RATE_MAX = parseInt(process.env.WEBO_PROGRESS_GET_MAX || '15', 10);  // per-IP restores per window (tighter: GET is the guess/enumeration surface, #24 M2)
const RATE_WINDOW = parseInt(process.env.WEBO_PROGRESS_WINDOW || '600', 10);
const MAX_LESSONS = 50;       // cap the array length
const MAX_ID_LEN = 24;        // cap each lesson id
const MAX_RECORD_BYTES = 2048; // cap the stored blob
const MAX_BODY_BYTES = parseInt(process.env.WEBO_MAX_BODY_BYTES || '8192', 10); // reject oversized bodies before parse (#24 L4)

// Friendly, kid-safe copy (no em dashes).
const MSG_BUSY = 'Lots of saving going on! \u{1F4A8} Give it a tiny moment and try again.';
const MSG_OFF = 'Saving to another device is not turned on right now. Your progress is still saved on this device! \u{1F4BE}';
const MSG_BAD = 'That code did not work. Please check it and try again! \u{1F50D}';
const MSG_OOPS = 'Hmm, that did not work. Please try again in a little bit! \u{1F916}';

function randomCode() {
  const bytes = require('crypto').randomBytes(CODE_LEN);
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return s;
}

// Normalize an untrusted code to the alphabet (drops dashes/spaces, uppercases).
function cleanCode(v) {
  if (typeof v !== 'string') return '';
  const up = v.toUpperCase().replace(new RegExp('[^' + CODE_ALPHABET + ']', 'g'), '');
  return up.slice(0, CODE_LEN);
}

// Rebuild a clean, PII-free progress record from untrusted input. Returns null if
// the shape is unusable. Only lesson ids + completed flags survive.
function sanitizeProgress(input) {
  if (!input || typeof input !== 'object') return null;
  const src = Array.isArray(input.lessons) ? input.lessons : null;
  if (!src) return null;
  const lessons = [];
  for (const l of src.slice(0, MAX_LESSONS)) {
    if (!l || typeof l !== 'object') continue;
    const id = typeof l.id === 'string' ? l.id.replace(/[^a-z0-9_-]/gi, '').slice(0, MAX_ID_LEN) : '';
    if (!id) continue;
    lessons.push({ id, completed: !!l.completed });
  }
  if (lessons.length === 0) return null;
  return { v: 1, stars: lessons.filter((l) => l.completed).length, lessons };
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const send = (status, obj) => res.status(status).json(obj);

  if (req.method !== 'POST' && req.method !== 'GET') {
    return send(405, { ok: false, error: MSG_OOPS });
  }
  if (!kvConfigured()) {
    return send(503, { ok: false, error: MSG_OFF });
  }

  const len = parseInt(req.headers['content-length'] || '0', 10);
  if (len > MAX_BODY_BYTES) return send(413, { ok: false, error: MSG_OOPS });

  // Separate, tighter limit for GET (the code-guess / enumeration surface) than for
  // POST (save), and a distinct bucket so a restore burst cannot exhaust the save
  // budget or vice versa (#24 M2). With the 32^8 CSPRNG keyspace this makes blind
  // enumeration hopeless, and bounds use of the store as a free anonymous KV.
  const ip = clientIp(req);
  const isGet = req.method === 'GET';
  const bucket = isGet ? `prog-get:${ip}` : `prog:${ip}`;
  const max = isGet ? GET_RATE_MAX : RATE_MAX;
  if (!(await limitOk(bucket, max, RATE_WINDOW))) {
    console.warn('[webo] progress rate-limited: ' + (isGet ? 'get' : 'save'));
    return send(429, { ok: false, error: MSG_BUSY });
  }

  // ---- restore: GET ?code=XXXX ----
  if (req.method === 'GET') {
    const code = cleanCode(req.query && req.query.code);
    if (code.length !== CODE_LEN) return send(400, { ok: false, error: MSG_BAD });
    try {
      const raw = await kvGet(`webo:progress:${code}`);
      if (!raw) return send(404, { ok: false, error: MSG_BAD });
      // Re-sanitize on read too (#24 L2): defense-in-depth so a restore can only
      // ever return the whitelisted, PII-free shape, even if a write path changed.
      const progress = sanitizeProgress(typeof raw === 'string' ? JSON.parse(raw) : raw);
      if (!progress) return send(404, { ok: false, error: MSG_BAD });
      return send(200, { ok: true, progress });
    } catch (e) {
      console.error('[webo] progress restore failed');
      return send(500, { ok: false, error: MSG_OOPS });
    }
  }

  // ---- save: POST { progress } -> { code } ----
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  const progress = sanitizeProgress(body && body.progress);
  if (!progress) return send(400, { ok: false, error: MSG_OOPS });

  const payload = JSON.stringify(progress);
  if (payload.length > MAX_RECORD_BYTES) return send(413, { ok: false, error: MSG_OOPS });

  try {
    // Generate a code that is not already taken (SET NX). Retry on a genuine
    // collision; bail immediately (and log accurately) on a KV write error so the
    // two failure modes are not conflated (#24 L1).
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomCode();
      const result = await kvSetNx(`webo:progress:${code}`, payload, TTL_SECONDS);
      if (result === 'ok') return send(200, { ok: true, code });
      if (result === 'error') {
        console.error('[webo] progress save: KV write failed');
        return send(503, { ok: false, error: MSG_OOPS });
      }
      // result === 'exists' -> code collision, try another
    }
    console.error('[webo] progress save: code-space collision after retries');
    return send(503, { ok: false, error: MSG_OOPS });
  } catch (e) {
    console.error('[webo] progress save failed');
    return send(500, { ok: false, error: MSG_OOPS });
  }
};

// Exposed for unit tests (do not call from the request path).
module.exports.sanitizeProgress = sanitizeProgress;
module.exports.cleanCode = cleanCode;
module.exports.randomCode = randomCode;

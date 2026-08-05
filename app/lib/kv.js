// Shared Vercel KV / Upstash Redis helpers + fail-open rate limiting.
//
// Used by /api/ask.js (rate limiting + cost ceiling) and /api/progress.js
// (anonymous cross-device resume codes). CommonJS so it bundles into each
// serverless function. There is no shared in-memory state across functions at
// runtime (each /api file is its own bundle/instance) - KV is the durable layer;
// the in-memory paths below are only a per-instance best-effort fallback.

// Resolve KV creds. Vercel's Marketplace KV/Upstash integration prefixes the env
// vars with the store name (e.g. WEBO_MONEY_WORLD_KV_REST_API_URL), so match the
// exact generic names first, then any var ENDING with the expected suffix. (We
// want the read-WRITE token, so the read-only `..._READ_ONLY_TOKEN` is excluded
// by suffix.)
function resolveEnv(suffixes) {
  for (const s of suffixes) if (process.env[s]) return process.env[s];
  const keys = Object.keys(process.env);
  for (const s of suffixes) {
    const k = keys.find((name) => name.endsWith(s));
    if (k && process.env[k]) return process.env[k];
  }
  return '';
}
const kvUrl = () => resolveEnv(['KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL']);
const kvToken = () => resolveEnv(['KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN']);
const kvConfigured = () => !!(kvUrl() && kvToken());

// Low-level Upstash REST command (array form). Returns the parsed JSON
// ({ result } | { error }) or null when KV is unconfigured / errors.
async function kvCmd(args) {
  const url = kvUrl(), token = kvToken();
  if (!url || !token) return null;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  }
}

// Atomic INCRBY + "set TTL only if the key has none", as a single server-side Lua
// script. This removes the prior INCR-then-EXPIRE TOCTOU (#24 M1): a key can never
// end up persistent (no-TTL) after a partial failure, so a rate-limit key cannot
// pin a child at the cap forever. TTL is (re)set only when missing, so the fixed
// window is preserved (not extended on every hit) and any legacy no-TTL key self-heals.
// Returns the post-incr count, or null on KV error/unconfigured (caller fails open).
const INCR_TTL_LUA =
  "local c = redis.call('INCRBY', KEYS[1], ARGV[1]) " +
  "if redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end " +
  "return c";
async function kvIncrBy(key, ttl, amount = 1) {
  const j = await kvCmd(['EVAL', INCR_TTL_LUA, '1', key, String(amount), String(ttl)]);
  if (!j || typeof j.result !== 'number') return null;
  return j.result;
}

// GET a string value. Returns the value, or null when missing / unconfigured.
async function kvGet(key) {
  const j = await kvCmd(['GET', key]);
  if (!j || j.result == null) return null;
  return j.result;
}

// SET NX with TTL (seconds). Returns 'ok' (stored), 'exists' (key already taken),
// or 'error' (KV unconfigured / transport failure) - a 3-state result so callers
// can distinguish a code collision (retry) from a KV outage (give up + log it
// accurately, #24 L1).
async function kvSetNx(key, value, ttl) {
  const j = await kvCmd(['SET', key, value, 'EX', String(ttl), 'NX']);
  if (j === null) return 'error';
  return j.result === 'OK' ? 'ok' : 'exists';
}

// ---- Rate limiting ----------------------------------------------------------
// Per-child limits FAIL OPEN: a transient KV error must never block a child. The
// GLOBAL cost ceiling instead fails to a LOW per-instance cap (see below), so a
// KV outage cannot turn into unbounded spend.
const memBuckets = new Map(); // bucket -> [timestamps] (in-memory fallback)
let memDay = -1, memDayCount = 0;

// Windowed per-child limit. true = allowed. KV-durable, else in-memory per instance.
async function limitOk(bucket, max, window) {
  const count = await kvIncrBy(`webo:rl:${bucket}`, window, 1);
  if (count !== null) return count <= max;
  const now = Date.now() / 1000;
  const arr = (memBuckets.get(bucket) || []).filter((t) => t > now - window);
  if (arr.length >= max) { memBuckets.set(bucket, arr); return false; }
  arr.push(now);
  memBuckets.set(bucket, arr);
  return true;
}

// Global daily cost ceiling (circuit breaker). Charge `units` of cost (the caller
// passes the number of model calls a request will make, NOT 1 per request - #24 H1)
// and report whether still under `max`. On KV outage we fail to `fallbackMax` (a
// LOW per-instance cap), NOT the full daily budget, so a multi-instance fan-out
// during an outage cannot each independently grant the whole ceiling (#24 H2). The
// true unbypassable backstop is a hard spend cap at the Anthropic billing layer.
async function chargeGlobalCeiling(units, max, fallbackMax) {
  const day = Math.floor(Date.now() / 86400000);
  const count = await kvIncrBy(`webo:cost:${day}`, 90000, units); // ~25h TTL
  if (count !== null) return count <= max;
  console.error('[webo] KV unavailable - global cost ceiling on per-instance fallback');
  if (memDay !== day) { memDay = day; memDayCount = 0; }
  memDayCount += units;
  return memDayCount <= fallbackMax;
}

module.exports = {
  resolveEnv, kvUrl, kvToken, kvConfigured, kvCmd,
  kvIncrBy, kvGet, kvSetNx, limitOk, chargeGlobalCeiling,
};

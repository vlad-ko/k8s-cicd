const { test } = require('node:test');
const assert = require('node:assert');

// Make kvConfigured()/kvCmd() proceed to fetch (creds are read lazily per call).
process.env.KV_REST_API_URL = 'https://test.example.upstash.io';
process.env.KV_REST_API_TOKEN = 'test-token';

const kv = require('../lib/kv');

const realFetch = global.fetch;
// Stub fetch. `mode`: 'json' returns { ok, json:()=>payload }; 'throw' rejects;
// 'notok' returns { ok:false }. Captures the last request body for assertions.
function stubFetch(mode, payload) {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push(JSON.parse(opts.body));
    if (mode === 'throw') throw new Error('KV down');
    if (mode === 'notok') return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => payload };
  };
  return calls;
}
function restore() { global.fetch = realFetch; }

test('kvIncrBy issues an atomic EVAL (INCRBY + conditional EXPIRE) and returns the count', async () => {
  const calls = stubFetch('json', { result: 5 });
  try {
    const n = await kv.kvIncrBy('webo:rl:test', 600, 1);
    assert.strictEqual(n, 5);
    assert.strictEqual(calls.length, 1, 'exactly one round-trip (atomic, not INCR-then-EXPIRE)');
    const [cmd, script, numkeys, key, amount, ttl] = calls[0];
    assert.strictEqual(cmd, 'EVAL');
    assert.match(script, /INCRBY/);
    assert.match(script, /EXPIRE/);
    assert.match(script, /TTL/);
    assert.strictEqual(numkeys, '1');
    assert.strictEqual(key, 'webo:rl:test');
    assert.strictEqual(amount, '1');
    assert.strictEqual(ttl, '600');
  } finally { restore(); }
});

test('kvIncrBy passes the weighted amount through (cost ceiling charges >1 per request)', async () => {
  const calls = stubFetch('json', { result: 9 });
  try {
    const n = await kv.kvIncrBy('webo:cost:123', 90000, 3);
    assert.strictEqual(n, 9);
    assert.strictEqual(calls[0][4], '3'); // amount arg
  } finally { restore(); }
});

test('kvSetNx returns ok / exists / error (so callers distinguish collision from outage)', async () => {
  try {
    stubFetch('json', { result: 'OK' });
    assert.strictEqual(await kv.kvSetNx('k', 'v', 60), 'ok');
    stubFetch('json', { result: null });
    assert.strictEqual(await kv.kvSetNx('k', 'v', 60), 'exists');
    stubFetch('notok');
    assert.strictEqual(await kv.kvSetNx('k', 'v', 60), 'error');
    stubFetch('throw');
    assert.strictEqual(await kv.kvSetNx('k', 'v', 60), 'error');
  } finally { restore(); }
});

test('limitOk fails OPEN (allows) when KV errors', async () => {
  stubFetch('throw');
  try {
    const ok = await kv.limitOk(`failopen-${Date.now()}-${Math.round(performance.now())}`, 1, 600);
    assert.strictEqual(ok, true, 'a transient KV error must never block a child');
  } finally { restore(); }
});

test('chargeGlobalCeiling fails to a LOW per-instance cap on a KV outage (not the full budget)', async () => {
  stubFetch('throw');
  try {
    // KV down. A single charge that exceeds the LOW fallback must trip, proving the
    // outage path does not grant the full daily budget (15000) per instance.
    const under = await kv.chargeGlobalCeiling(300, 15000, 300);
    assert.strictEqual(under, true, '300 units == fallback cap, still under');
    const over = await kv.chargeGlobalCeiling(1, 15000, 300);
    assert.strictEqual(over, false, 'next unit exceeds the 300 fallback -> ceiling trips');
  } finally { restore(); }
});

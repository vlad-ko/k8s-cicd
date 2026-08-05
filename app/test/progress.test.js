const { test } = require('node:test');
const assert = require('node:assert');
const { sanitizeProgress, cleanCode, randomCode } = require('../api/progress');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

test('sanitizeProgress keeps ONLY whitelisted lesson fields (the COPPA no-PII invariant)', () => {
  const out = sanitizeProgress({
    stars: 999,                          // attacker-supplied, must be ignored/recomputed
    evilField: 'hacker@email.com',       // PII smuggle, must be dropped
    lessons: [
      { id: 'jars', completed: true, secret: 'PII-here' }, // extra key must be dropped
      { id: 'penny', completed: false },
    ],
  });
  assert.deepStrictEqual(out, {
    v: 1,
    stars: 1, // recomputed from completed flags, NOT the client's 999
    lessons: [
      { id: 'jars', completed: true },
      { id: 'penny', completed: false },
    ],
  });
  // No stray keys leaked through.
  assert.deepStrictEqual(Object.keys(out).sort(), ['lessons', 'stars', 'v']);
  assert.deepStrictEqual(Object.keys(out.lessons[0]).sort(), ['completed', 'id']);
});

test('sanitizeProgress coerces completed to a real boolean', () => {
  const out = sanitizeProgress({ lessons: [{ id: 'jars', completed: 'yes' }, { id: 'penny', completed: 0 }] });
  assert.strictEqual(out.lessons[0].completed, true);
  assert.strictEqual(out.lessons[1].completed, false);
  assert.strictEqual(out.stars, 1);
});

test('sanitizeProgress strips disallowed characters from lesson ids and caps length', () => {
  const out = sanitizeProgress({ lessons: [{ id: 'ja rs<script>', completed: true }] });
  assert.strictEqual(out.lessons[0].id, 'jarsscript'); // spaces + <> removed
  const long = sanitizeProgress({ lessons: [{ id: 'x'.repeat(100), completed: true }] });
  assert.strictEqual(long.lessons[0].id.length, 24);
});

test('sanitizeProgress caps the number of lessons', () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ id: 'l' + i, completed: true }));
  const out = sanitizeProgress({ lessons: many });
  assert.strictEqual(out.lessons.length, 50);
});

test('sanitizeProgress rejects unusable input', () => {
  assert.strictEqual(sanitizeProgress(null), null);
  assert.strictEqual(sanitizeProgress('nope'), null);
  assert.strictEqual(sanitizeProgress({}), null);
  assert.strictEqual(sanitizeProgress({ lessons: [] }), null);
  assert.strictEqual(sanitizeProgress({ lessons: [{ completed: true }] }), null); // no valid id
});

test('cleanCode normalizes: uppercases, drops dashes/spaces/ambiguous chars, caps length', () => {
  assert.strictEqual(cleanCode('7xd9-r9jh'), '7XD9R9JH');
  assert.strictEqual(cleanCode('  ab cd 23 45  '), 'ABCD2345');
  assert.strictEqual(cleanCode('ABCDEFGHIJK'), 'ABCDEFGH'); // capped to 8 (I is not in alphabet, dropped first)
  assert.strictEqual(cleanCode(42), '');
  assert.strictEqual(cleanCode(null), '');
});

test('randomCode returns 8 chars from the unambiguous alphabet', () => {
  for (let i = 0; i < 200; i++) {
    const c = randomCode();
    assert.strictEqual(c.length, 8);
    for (const ch of c) assert.ok(CODE_ALPHABET.includes(ch), `unexpected char ${ch}`);
  }
});

test('randomCode is not trivially constant', () => {
  const a = randomCode(), b = randomCode();
  assert.notStrictEqual(a, b); // 1 in 32^8 chance of false failure - negligible
});

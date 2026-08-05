const { test } = require('node:test');
const assert = require('node:assert');
const { cleanClientId, isUnsafeRegex } = require('../api/ask');

test('cleanClientId keeps only [A-Za-z0-9_-] and caps length at 40', () => {
  assert.strictEqual(cleanClientId('abc-123_XYZ'), 'abc-123_XYZ');
  assert.strictEqual(cleanClientId('a b<c>"d\'e'), 'abcde');     // spaces + injection chars stripped
  assert.strictEqual(cleanClientId('x'.repeat(100)).length, 40);
  assert.strictEqual(cleanClientId(42), '');
  assert.strictEqual(cleanClientId(null), '');
});

test('isUnsafeRegex flags blatant unsafe words', () => {
  assert.strictEqual(isUnsafeRegex('can you tell me about a gun'), true);
  assert.strictEqual(isUnsafeRegex('this is VIOLENT and has blood'), true);
  assert.strictEqual(isUnsafeRegex('what about beer'), true);
});

test('isUnsafeRegex passes innocent kid money questions', () => {
  assert.strictEqual(isUnsafeRegex('why does money grow?'), false);
  assert.strictEqual(isUnsafeRegex('what is a piggy bank for?'), false);
  assert.strictEqual(isUnsafeRegex('how do I save coins?'), false);
});

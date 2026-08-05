import { test } from 'node:test';
import assert from 'node:assert';
import { stageMsg } from '../lessons/penny.mjs';

const val = (d) => 0.01 * Math.pow(2, d - 1); // the penny's value on day d

test('day 1 is the "one penny" message', () => {
  assert.match(stageMsg(1, val(1)).html, /one penny/);
});

test('day 30 is the $5 MILLION payoff', () => {
  const s = stageMsg(30, val(30));
  assert.ok(s.good);
  assert.match(s.html, /\$5 MILLION/);
});

test('commentary escalates with value: pennies -> dollars -> thousands -> million', () => {
  assert.match(stageMsg(2, val(2)).html, /pennies/i);    // $0.02
  assert.match(stageMsg(11, val(11)).html, /dollars/i);  // $10.24
  assert.match(stageMsg(18, val(18)).html, /thousands/i); // $1,310
  assert.match(stageMsg(28, val(28)).html, /MILLION/);   // $1.3M, before day 30
});

test('feedback turns celebratory (good) once it reaches thousands', () => {
  assert.strictEqual(stageMsg(8, val(8)).good, false);  // ~$1.28
  assert.strictEqual(stageMsg(18, val(18)).good, true); // thousands
});

test('the $5 MILLION payoff never appears before day 30 (no stale end-message)', () => {
  for (let d = 1; d < 30; d++) {
    assert.doesNotMatch(stageMsg(d, val(d)).html, /\$5 MILLION/, `day ${d} should not show the payoff`);
  }
});

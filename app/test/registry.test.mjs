import { test } from 'node:test';
import assert from 'node:assert';
import { LESSONS } from '../lessons/index.mjs';

test('registry has the expected lessons in order', () => {
  assert.strictEqual(LESSONS.length, 9);
  assert.deepStrictEqual(LESSONS.map((l) => l.id), ['jars', 'penny', 'seeds', 'needs', 'goal', 'earn', 'giving', 'safe', 'taxes']);
});

test('every lesson has the required fields and a runnable flow', () => {
  LESSONS.forEach((l, i) => {
    assert.ok(typeof l.id === 'string' && l.id.length, `lesson ${i} id`);
    assert.strictEqual(l.no, `LESSON ${i + 1}`, `lesson ${i} number is sequential`);
    assert.ok(typeof l.name === 'string' && l.name.length, `lesson ${i} name`);
    assert.ok(typeof l.sub === 'string' && l.sub.length, `lesson ${i} sub`);
    assert.ok(typeof l.icon === 'string' && l.icon.length, `lesson ${i} icon`);
    assert.ok(typeof l.rewardTitle === 'string' && l.rewardTitle.length, `lesson ${i} rewardTitle`);
    assert.strictEqual(typeof l.run, 'function', `lesson ${i} run()`);
    assert.ok(l.prop && typeof l.prop.html === 'string' && l.prop.html.length, `lesson ${i} prop.html`);
    // A prop must be placeable: either a tuned CSS class or an inline position.
    assert.ok(l.prop.cls || l.prop.pos, `lesson ${i} prop needs a cls or pos`);
  });
});

test('lesson ids are unique (no duplicate progress keys)', () => {
  const ids = LESSONS.map((l) => l.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

test('reward titles are unique (each completion feels distinct)', () => {
  const titles = LESSONS.map((l) => l.rewardTitle);
  assert.strictEqual(new Set(titles).size, titles.length);
});

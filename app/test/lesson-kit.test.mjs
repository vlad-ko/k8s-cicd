import { test } from 'node:test';
import assert from 'node:assert';
import { weboHtml, speech, escapeHtml, mergeProgress, prefersReducedMotion } from '../lib/lesson-kit.mjs';

test('escapeHtml encodes the dangerous HTML characters', () => {
  assert.strictEqual(escapeHtml('<b>"x"</b> & y'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt; &amp; y');
  assert.strictEqual(escapeHtml('plain'), 'plain');
  assert.strictEqual(escapeHtml(42), '42');
});

test('speech wraps text in a bubble with the Webo avatar', () => {
  const html = speech('hello money');
  assert.ok(html.includes('hello money'));
  assert.ok(html.includes('class="speech"'));
  assert.ok(html.includes('class="bubble"'));
  assert.ok(html.includes(weboHtml()));
});

test('mergeProgress ORs completed flags and never downgrades a local star', () => {
  const lessons = [
    { id: 'jars', completed: true },
    { id: 'penny', completed: false },
    { id: 'seeds', completed: false },
  ];
  mergeProgress(lessons, { lessons: [
    { id: 'jars', completed: false },  // must NOT downgrade the local true
    { id: 'penny', completed: true },  // upgrades
    { id: 'ghost', completed: true },  // unknown id ignored
  ] });
  assert.strictEqual(lessons.find((l) => l.id === 'jars').completed, true);
  assert.strictEqual(lessons.find((l) => l.id === 'penny').completed, true);
  assert.strictEqual(lessons.find((l) => l.id === 'seeds').completed, false);
  assert.strictEqual(lessons.length, 3, 'unknown ids do not add entries');
});

test('mergeProgress tolerates a missing/garbage blob', () => {
  const lessons = [{ id: 'jars', completed: false }];
  assert.doesNotThrow(() => mergeProgress(lessons, null));
  assert.doesNotThrow(() => mergeProgress(lessons, {}));
  assert.doesNotThrow(() => mergeProgress(lessons, { lessons: 'nope' }));
  assert.strictEqual(lessons[0].completed, false);
});

test('prefersReducedMotion is safe to call without a window (returns false)', () => {
  assert.strictEqual(prefersReducedMotion(), false);
});

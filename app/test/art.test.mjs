import { test } from 'node:test';
import assert from 'node:assert';
import { WEBO_SVG, WEBO_ART, weboHtml, propArt } from '../lib/lesson-kit.mjs';

test('propArt falls back to the SVG when no image is set', () => {
  assert.strictEqual(propArt({ html: '<svg>jars</svg>' }), '<svg>jars</svg>');
});

test('propArt prefers an image asset over the SVG when prop.img is set', () => {
  const out = propArt({ img: '/assets/props/safe.png', html: '<svg>fallback</svg>' });
  assert.match(out, /<img src="\/assets\/props\/safe\.png"/);
  assert.match(out, /class="prop-img"/);
  assert.doesNotMatch(out, /<svg>/);
});

test('propArt applies an optional display size', () => {
  assert.match(propArt({ img: '/a.png', size: '60px' }), /style="width:60px"/);
  assert.doesNotMatch(propArt({ img: '/a.png' }), /style=/);
});

test('propArt is null-safe', () => {
  assert.strictEqual(propArt(null), '');
  assert.strictEqual(propArt(undefined), '');
});

test('weboHtml swaps in the character art when WEBO_ART is set, else the inline SVG', () => {
  const out = weboHtml();
  if (WEBO_ART) {
    assert.match(out, new RegExp(`<img src="${WEBO_ART}"`));
    assert.match(out, /class="webo-art"/);
    assert.doesNotMatch(out, /<svg/);
  } else {
    assert.strictEqual(out, WEBO_SVG);
    assert.match(out, /<svg/);
  }
});

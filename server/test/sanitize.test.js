import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasUnsafe, inertValue, revealText } from '../src/sanitize.js';

const ZW = String.fromCharCode(0x200B); const RLO = String.fromCharCode(0x202E); const BELL = String.fromCharCode(7);

test('hidden characters are shown as [U+XXXX]', () => {
  assert.equal(revealText(`a${ZW}b`), 'a[U+200B]b');
  assert.equal(revealText(`x${RLO}y`), 'x[U+202E]y');
  assert.equal(revealText(`q${BELL}`), 'q[U+0007]');
  assert.equal(revealText('\uD800'), '[U+D800]', 'a lone surrogate is revealed');
  assert.equal(revealText('plain text 123'), 'plain text 123');
});

test('revealText bounds the length', () => {
  assert.equal(revealText('a'.repeat(5000), 10), `${'a'.repeat(10)}…`);
});

test('hasUnsafe sees invisible and control characters', () => {
  assert.ok(hasUnsafe(`a${ZW}`) && hasUnsafe(BELL));
  assert.ok(!hasUnsafe('ordinary'));
});

test('inertValue reveals strings and keys, bounds depth, arrays and keys, and reports hidden characters', () => {
  const seen = { hidden: false };
  const out = inertValue({ [`k${ZW}`]: [`v${RLO}`], deep: { a: { b: { c: { d: { e: { f: 1 } } } } } } }, seen);
  assert.equal(seen.hidden, true);
  assert.deepEqual(Object.keys(out).slice(0, 1), ['k[U+200B]']);
  assert.equal(out['k[U+200B]'][0], 'v[U+202E]');
  assert.equal(JSON.stringify(out).includes('[truncated]'), true);
  assert.equal(inertValue(Array.from({ length: 500 }, (_, i) => i)).length, 50);
  assert.equal(inertValue(Number.NaN), null);
  const clean = { hidden: false }; inertValue({ a: 'b' }, clean); assert.equal(clean.hidden, false);
});

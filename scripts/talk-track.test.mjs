import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { TALK, render } from './build-talk-track.mjs';

const root = path.resolve(import.meta.dirname, '..');

test('docs/talk-track.md is exactly what the talk-track data produces (run: npm run talk-track)', () => {
  assert.equal(fs.readFileSync(path.join(root, 'docs/talk-track.md'), 'utf8'), render(), 'docs/talk-track.md is stale; regenerate it and commit the result');
});

test('the talk track data names every scenario and keeps the UNVERIFIED retention caveat', () => {
  const text = JSON.stringify(TALK);
  const ids = [...fs.readFileSync(path.join(root, 'server/src/scenarios.js'), 'utf8').matchAll(/^  \{ id: '([\w-]+)'/gm)].map((m) => m[1]);
  assert.equal(ids.length, 6);
  for (const id of ids) assert.ok(text.includes(`\`${id}\``), id);
  assert.match(TALK.sayFirst, /not verified it against product documentation/);
  assert.equal(TALK.steps.length, 10);
  assert.ok(TALK.steps.every((s) => s.title && s.say));
});

test('the generator is deterministic and says each step once, in order', () => {
  assert.equal(render(), render());
  const lines = render().split('\n').filter((l) => /^\d+\. /.test(l));
  assert.equal(lines.length, TALK.steps.length);
  lines.forEach((l, i) => assert.ok(l.startsWith(`${i + 1}. **${TALK.steps[i].title}**`)));
});

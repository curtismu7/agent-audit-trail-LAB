import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAST, resolveTokens, tokensIn } from '../src/cast.js';
import { createRng } from '../src/rng.js';
import { SCENARIOS, describeScenario, runScenario, seedAll } from '../src/scenarios.js';
import { createStore } from '../src/store.js';
import { NOW } from './helpers.js';

const key = Buffer.alloc(32, 2);
const seeded = (seed) => { const s = createStore({ now: () => NOW, key }); seedAll(s, { rng: createRng(seed), now: NOW }); return s; };

test('STORIES: every {{cast}} token in every story resolves; an undefined token fails', () => {
  assert.equal(SCENARIOS.length, 6);
  for (const s of SCENARIOS) {
    assert.ok(tokensIn(s.story).length > 0, `${s.id} uses cast tokens`);
    const text = describeScenario(s).story;
    assert.doesNotMatch(text, /\{\{|\}\}/, `${s.id} still has a placeholder`);
  }
  assert.throws(() => resolveTokens('hello {{users.nobody.name}}'), /undefined story token/);
  assert.throws(() => resolveTokens('{{users.alice}}'), /undefined story token/, 'an object is not a string value');
  assert.throws(() => resolveTokens('{{__proto__.x}}'), /undefined story token/);
  assert.equal(resolveTokens('{{users.alice.name}}'), CAST.users.alice.name);
});

test('the six required scenarios exist', () => {
  assert.deepEqual(SCENARIOS.map((s) => s.id), ['normal-purchase', 'denied-scope', 'paused-approved', 'killed-mid-run', 'orphaned-event', 'two-hop-delegation']);
});

test('DETERMINISM: the same seed gives byte-identical events; a different seed gives different ids', () => {
  const a = seeded(11); const b = seeded(11); const c = seeded(12);
  assert.deepEqual(a.all(), b.all());
  assert.equal(a.chain.head.hash, b.chain.head.hash, 'same key, same events, same chain');
  assert.notDeepEqual(a.all().map((e) => e.traceId), c.all().map((e) => e.traceId));
});

test('SYNTHETIC ONLY: every host in every event is .example and no real-looking identifier shapes appear', () => {
  const text = JSON.stringify(seeded(1).all());
  for (const host of text.match(/https?:\/\/[^"/\s]+/g) ?? []) assert.match(host, /\.example$/, host);
  assert.doesNotMatch(text, /\b(?:pingone|pingidentity|ping-devops|amazonaws|localhost)\b/i);
  assert.doesNotMatch(text, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, 'no UUID that could be mistaken for a tenant or client id');
  assert.doesNotMatch(text, /eyJ[A-Za-z0-9_-]{10,}/, 'no JWT-shaped string');
  assert.ok(text.includes('MOCK-ISSUED'), 'token events are labelled as mock-issued');
});

test('the seed has events from all six sources and some beyond the retention window', () => {
  const s = seeded(1);
  assert.deepEqual([...new Set(s.all().map((e) => e.source))].sort(), ['gateway', 'hitl', 'idp', 'killswitch', 'policy', 'token']);
  assert.equal(s.retentionDemo(30).storedBeyondRetention, 6);
});

test('a source clock is never in the future relative to now', () => {
  const s = seeded(1);
  assert.ok(s.all().every((e) => Date.parse(e.recordedAt) <= NOW.getTime()));
});

test('running a scenario again appends a fresh instance with new ids and a verifying chain', () => {
  const s = seeded(1); const rng = createRng(99);
  const before = s.size;
  const r1 = runScenario(s, 'normal-purchase', { rng, start: new Date(NOW.getTime() - 60_000) });
  const r2 = runScenario(s, 'normal-purchase', { rng, start: new Date(NOW.getTime() - 60_000) });
  assert.notEqual(r1.traceId, r2.traceId); assert.equal(s.size, before + r1.eventIds.length + r2.eventIds.length);
  assert.equal(s.chain.verify().ok, true);
  assert.throws(() => runScenario(s, 'nope', { rng, start: NOW }), (e) => e.code === 'no_scenario');
});

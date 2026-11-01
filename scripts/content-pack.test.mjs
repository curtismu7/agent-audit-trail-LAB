import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { PACK_PATH, buildPack, serialize } from './build-content-pack.mjs';
import { validatePack } from './validate-content-pack.mjs';

test('content-pack.json is exactly what the generator produces (run: npm run content-pack)', () => {
  assert.equal(fs.readFileSync(PACK_PATH, 'utf8'), serialize(buildPack()), 'content-pack.json is stale; regenerate it and commit the result');
});

test('the generator is deterministic', () => assert.equal(serialize(buildPack()), serialize(buildPack())));

test('content-pack.json validates against docs/content-pack.schema.json', () => {
  assert.deepEqual(validatePack(JSON.parse(fs.readFileSync(PACK_PATH, 'utf8'))), []);
});

test('the validator rejects a broken pack', () => {
  const pack = buildPack();
  pack.cards[0].terms = ['no-such-term'];
  delete pack.title;
  assert.ok(validatePack(pack).length >= 2);
});

test('the validator enforces the rules the schema cannot express (dotted id, control char, JWT-shaped value)', () => {
  const jwt = ['eyJ' + 'a'.repeat(12), 'b'.repeat(12), 'c'.repeat(12)].join('.');
  const mutate = (fn) => { const p = buildPack(); fn(p); return validatePack(p); };
  assert.ok(mutate((p) => { p.glossary[0].id = 'a.b'; }).some((e) => /no dot/.test(e)));
  assert.ok(mutate((p) => { p.glossary[0].definition += '\u0001'; }).some((e) => /control character/.test(e)));
  assert.ok(mutate((p) => { p.glossary[0].definition += ` ${jwt}`; }).some((e) => /JWT-shaped/.test(e)));
  assert.ok(mutate((p) => { p.glossary[1].id = p.glossary[0].id; }).some((e) => /duplicate/.test(e)));
  assert.deepEqual(validatePack(buildPack()), []);
});

test('the pack covers the app and keeps the UNVERIFIED label on retention', () => {
  const pack = buildPack();
  for (const id of ['audit-trail', 'correlation-id', 'traceparent', 'token-exchange', 'act-claim', 'join', 'gap', 'orphaned-event', 'retention-clamp', 'silent-empty', 'hash-chain', 'read-only-tools', 'inert-text', 'demo-mode']) assert.ok(pack.glossary.some((g) => g.id === id), id);
  assert.match(pack.glossary.find((g) => g.id === 'retention-clamp').definition, /UNVERIFIED/);
  assert.deepEqual(pack.sources, []);
  assert.equal(pack.demo.baseUrl, 'http://localhost:6600'); assert.equal(pack.demo.catalog, 'D17'); assert.equal(pack.id, 'agent-audit-trail-lab');
});

test('every story says exactly what the UI story strip says', () => {
  const jsx = fs.readFileSync(new URL('../web/src/components/Story.jsx', import.meta.url), 'utf8');
  for (const s of buildPack().stories) assert.ok(jsx.includes(`proves: "${s.say}"`), `Story.jsx does not carry the text of ${s.id}`);
});

test('a commit is recorded only when passed', () => {
  assert.equal(buildPack().source, undefined);
  assert.equal(buildPack({ commit: 'abc1234' }).source.commit, 'abc1234');
});

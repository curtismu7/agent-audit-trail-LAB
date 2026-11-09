// Mutation pins for the guards and error handlers (AT2). Guard functions are driven directly; 500 handlers over a real socket.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { credentialGuard, hostGuard, isLoopbackHost, makeHostGuard, makeOriginGuard, originGuard, parseAllowedHosts, parseHost } from '../src/safety.js';
import { boot, freeBase, mkRuntime, request } from './helpers.js';
import { startHttpServer } from '../src/app.js';

const run = (guard, headers, method = 'POST') => {
  let out = { next: false, status: null, body: null };
  const res = { status(s) { out.status = s; return this; }, json(b) { out.body = b; return this; } };
  guard({ method, headers }, res, () => { out.next = true; });
  return out;
};

test('Host: anchoring and octet range (DNS rebinding lookalikes are refused)', () => {
  for (const h of ['evil-localhost', 'evil.localhost', 'x127.0.0.1', 'xlocalhost', 'x[::1]', '127.0.0.999', '127.256.0.1', '127.0.0.256', '127.0.0.1x', 'localhostx', '127.0.0.1.', '127.0.0', '127.0.0.1.1', ' evil.example', '127.0.0.1:99999', '127.0.0.1:65536']) {
    assert.equal(parseHost(h), null, h);
    assert.equal(run(hostGuard, { host: h }, 'GET').status, 421, h);
  }
  for (const h of ['127.0.0.255', '127.255.255.255', '127.0.0.0', 'localhost:65535', '127.0.0.1:1']) assert.ok(parseHost(h), h);
  assert.equal(isLoopbackHost('127.0.0.999'), false); assert.equal(isLoopbackHost('127.0.0.256'), false); assert.equal(isLoopbackHost('127.0.0.255'), true);
  assert.equal(isLoopbackHost('evil.localhost'), false);
  assert.equal(run(hostGuard, {}, 'GET').status, 421, 'a missing Host is refused');
  assert.equal(run(hostGuard, { host: '127.0.0.1:6600' }, 'GET').next, true);
});

test('JSON-only: the content type must BE application/json, a chunked body counts as a body, https origins are refused', () => {
  const base = { host: '127.0.0.1:6600' };
  const ok = run(originGuard, { ...base, 'content-length': '2', 'content-type': 'application/json' });
  assert.equal(ok.next, true);
  assert.equal(run(originGuard, { ...base, 'content-length': '2', 'content-type': 'application/json; charset=utf-8' }).next, true);
  for (const ct of ['text/plain; application/json', 'text/plain', 'x-application/json', 'application/jsonx', 'application/json-seq', '', undefined, 'multipart/form-data; boundary=application/json']) {
    assert.equal(run(originGuard, { ...base, 'content-length': '2', ...(ct === undefined ? {} : { 'content-type': ct }) }).status, 415, String(ct));
  }
  assert.equal(run(originGuard, { ...base, 'transfer-encoding': 'chunked', 'content-type': 'text/plain' }).status, 415, 'chunked text/plain is a body');
  assert.equal(run(originGuard, { ...base, 'transfer-encoding': 'chunked', 'content-type': 'application/json' }).next, true);
  assert.equal(run(originGuard, { ...base }).next, true, 'no body, no content type needed');
  assert.equal(run(originGuard, { ...base, origin: 'https://127.0.0.1:6600' }).status, 403, 'https origin');
  assert.equal(run(originGuard, { ...base, origin: 'http://127.0.0.1:6600' }).next, true);
  assert.equal(run(originGuard, { ...base, origin: 'null' }).status, 403);
  assert.equal(run(originGuard, { ...base, origin: 'http://127.0.0.1:6600', 'sec-fetch-site': 'cross-site' }).status, 403);
  assert.equal(run(originGuard, { ...base, origin: 'http://127.0.0.1:6600', 'sec-fetch-site': 'same-origin' }).next, true);
  for (const m of ['GET', 'HEAD', 'OPTIONS']) assert.equal(run(originGuard, { ...base, origin: 'https://evil.example' }, m).next, true, `${m} is a read`);
});

test('credentials: the whole documented list is refused', () => {
  for (const h of ['authorization', 'proxy-authorization', 'x-api-key', 'x-auth-token', 'x-access-token', 'x-amz-security-token', 'x-csrf-token', 'x-session-token', 'api-key']) {
    assert.equal(run(credentialGuard, { [h]: 'x' }, 'GET').status, 400, h);
  }
  assert.equal(run(credentialGuard, { host: 'x' }, 'GET').next, true);
});

test('500s never leak: the MCP handler returns a bare Internal error', async () => {
  const rt = mkRuntime();
  rt.tools = { list: () => { throw new Error('secret stack /Users/someone/db.sqlite'); }, call: () => ({}) };
  const s = await boot('guards', rt);
  const orig = console.error; console.error = () => {};
  try {
    const r = await request(s.port, 'POST', '/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
    assert.equal(r.status, 500); assert.deepEqual(r.json, { jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } });
    assert.doesNotMatch(r.raw, /secret|Users|sqlite|at /);
  } finally { console.error = orig; await s.close(); }
});

test('500s never leak: the app-level handler (outside /api and /mcp) returns a bare server_error', async (t) => {
  if (process.getuid?.() === 0) return t.skip('root can read a chmod 000 file');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aat-dist-'));
  const index = path.join(dir, 'index.html'); fs.writeFileSync(index, '<!doctype html>secret-body'); fs.chmodSync(index, 0o000);
  const port = await freeBase('guards', 1);
  const srv = await startHttpServer({ port, host: '127.0.0.1', runtime: mkRuntime(), webDist: dir });
  const orig = console.error; console.error = () => {};
  try {
    const r = await request(srv.port, 'GET', '/index.html');
    assert.equal(r.status, 500); assert.deepEqual(r.json, { error: 'server_error' }); assert.doesNotMatch(r.raw, /EACCES|aat-dist|permission|secret/i);
  } finally { console.error = orig; await srv.close(); fs.chmodSync(index, 0o600); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('REST query: unknown keys (including __proto__ and constructor) are 400, never silently ignored', async () => {
  const s = await boot('guards');
  try {
    for (const q of ['__proto__=x', 'constructor=x', 'bogus=1', 'toString=1']) {
      for (const p of ['/api/events', '/api/events/summary']) assert.equal((await request(s.port, 'GET', `${p}?${q}`)).status, 400, `${p}?${q}`);
    }
    assert.equal((await request(s.port, 'GET', '/api/events?actor=a&actor=b')).status, 400, 'repeated key');
    assert.equal((await request(s.port, 'GET', '/api/events?limit=3&orphaned=true')).status, 200);
  } finally { await s.close(); }
});

test('MCP: __proto__ and constructor arguments are refused, a non-finite id is refused, an own-property check guards the schema', async () => {
  const s = await boot('guards');
  try {
    const call = (args, id = 1) => request(s.port, 'POST', '/mcp', { body: `{"jsonrpc":"2.0","id":${id},"method":"tools/call","params":{"name":"search_audit_activities","arguments":${args}}}` });
    for (const a of ['{"__proto__":{"x":1}}', '{"constructor":"x"}', '{"toString":"x"}', '{"hasOwnProperty":"x"}']) {
      const r = await call(a); assert.equal(r.json.result.isError, true, a); assert.match(r.json.result.content[0].text, /unknown argument/);
    }
    const inf = await call('{}', '1e400');
    assert.equal(inf.json.error.code, -32600); assert.equal(inf.json.id, null);
    assert.equal((await call('{}', 7)).json.id, 7);
  } finally { await s.close(); }
});

test('REST parameter bounds: retention-demo, chain list, tamper demo and integers are strict', async () => {
  const s = await boot('guards');
  try {
    const st = async (m, p, body) => (await request(s.port, m, p, { body })).status;
    assert.equal(await st('GET', '/api/retention-demo?days=365'), 200);
    assert.equal(await st('GET', '/api/retention-demo?days=366'), 400);
    assert.equal(await st('GET', '/api/retention-demo?days=1.5'), 400);
    assert.equal(await st('GET', '/api/events?days=5.0'), 400);
    assert.equal(await st('GET', '/api/events?days=1e3'), 400);
    assert.equal(await st('GET', '/api/events?limit=1000000001'), 400, 'integers stop at 1e9');
    assert.equal(await st('GET', '/api/chain?after=1000000000'), 400, 'after is at most 9 digits');
    assert.equal(await st('GET', '/api/chain?after=1.5'), 400);
    assert.equal(await st('GET', '/api/chain?after=0x10'), 400);
    assert.equal(await st('GET', '/api/chain?limit=0'), 400);
    assert.equal(await st('GET', '/api/chain?limit=501'), 400);
    assert.equal(await st('GET', '/api/chain?limit=12345'), 400);
    assert.equal(await st('GET', '/api/chain?limit=500'), 200);
    assert.equal(await st('POST', '/api/chain/tamper-demo', { kind: 'edit', seq: 100000 }), 200);
    assert.equal(await st('POST', '/api/chain/tamper-demo', { kind: 'edit', seq: 100001 }), 400);
    assert.equal(await st('POST', '/api/chain/tamper-demo', { kind: 'edit', seq: 0 }), 400);
    assert.equal(await st('POST', '/api/chain/tamper-demo', { kind: 'edit-timestamp' }), 200);
    assert.equal(await st('GET', `/api/join?traceId=${'0'.repeat(32)}`), 400, 'an all-zero trace id is invalid, not merely unknown');
  } finally { await s.close(); }
});

// ---- workspaces, mode setting, customer config, vertical packs (rules 1, 10, 12, 13)
import { PACKS, castFor, resolveTokens, tokensIn } from '../src/cast.js';
import { DEFAULT_CUSTOMER, LIVE_REFUSAL, loadCustomer, modeFrom, normalizeCustomer } from '../src/config.js';
import { SCENARIOS } from '../src/scenarios.js';
import { MAX_WORKSPACES, createWorkspaces } from '../src/workspaces.js';
import { createRuntime } from '../src/runtime.js';
import { allPassed, runChecks } from '../src/doctor.js';
import { NOW } from './helpers.js';

test('VERTICAL PACKS: three packs, every story token resolves in every pack, an undefined token fails in each', () => {
  assert.deepEqual(Object.keys(PACKS).sort(), ['banking', 'healthcare', 'retail']);
  for (const [name, cast] of Object.entries(PACKS)) {
    for (const s of SCENARIOS) {
      assert.ok(tokensIn(s.story).length > 0);
      assert.doesNotMatch(resolveTokens(s.story, cast), /\{\{/, `${name}/${s.id}`);
    }
    assert.throws(() => resolveTokens('{{users.nobody.name}}', cast), /undefined story token/);
    assert.throws(() => resolveTokens('{{users}}', cast), /undefined story token/);
  }
  assert.equal(castFor('nope'), null); assert.equal(castFor('__proto__'), null); assert.equal(castFor('constructor'), null);
  // The packs really differ: a story names different people and tools.
  const texts = Object.values(PACKS).map((c) => resolveTokens(SCENARIOS[0].story, c));
  assert.equal(new Set(texts).size, 3);
});

test('VERTICAL PACKS: each pack seeds a store whose join sentence uses that pack\'s names only', () => {
  for (const [name, cast] of Object.entries(PACKS)) {
    const rt = createRuntime({ now: () => NOW, vertical: name });
    const run = rt.runScenario('normal-purchase');
    const j = rt.join.byTrace(run.traceId);
    assert.equal(rt.store.chain.verify().ok, true);
    assert.match(j.sentence, new RegExp(cast.users.alice.name)); assert.match(j.sentence, new RegExp(cast.tools.purchase.name.replace('.', '\\.')));
    if (name !== 'retail') assert.doesNotMatch(j.sentence, /Alice Example|purchase\.create/);
  }
  assert.throws(() => createRuntime({ vertical: 'nope' }), /unknown vertical/);
});

test('reset can switch the vertical pack; an unknown one is a 400', async () => {
  const s = await boot('guards');
  try {
    const b = await request(s.port, 'POST', '/api/reset', { body: { vertical: 'banking' } });
    assert.equal(b.status, 200); assert.equal(b.json.vertical, 'banking');
    const sc = await request(s.port, 'GET', '/api/scenarios');
    assert.match(sc.json.scenarios[0].story, /Anya Ledger/);
    assert.equal((await request(s.port, 'GET', '/api/info')).json.vertical, 'banking');
    for (const v of ['nope', '__proto__', 5]) assert.equal((await request(s.port, 'POST', '/api/reset', { body: { vertical: v } })).status, 400);
    assert.equal((await request(s.port, 'POST', '/api/reset', { body: { other: 1 } })).status, 400);
  } finally { await s.close(); }
});

test('WORKSPACES: one visitor\'s Reset and runs never touch another\'s; bad ids are 400', async () => {
  const s = await boot('guards');
  try {
    const as = (id) => ({ headers: id === undefined ? {} : { 'x-workspace-id': id } });
    const n = async (id) => (await request(s.port, 'GET', '/api/info', as(id))).json.events;
    const base = await n(undefined);
    assert.equal((await request(s.port, 'POST', '/api/scenarios/normal-purchase/run', { body: {}, ...as('tab-a') })).status, 200);
    assert.ok(await n('tab-a') > base, 'tab-a grew');
    assert.equal(await n('tab-b'), base, 'tab-b is untouched');
    assert.equal(await n(undefined), base, 'the default workspace is untouched');
    assert.equal((await request(s.port, 'POST', '/api/reset', { body: {}, ...as('tab-b') })).status, 200);
    assert.ok(await n('tab-a') > base, 'tab-b\'s Reset did not reset tab-a');
    assert.equal((await request(s.port, 'GET', '/api/info', as('tab-a'))).json.workspace, 'tab-a');
    // MCP honours the workspace too.
    const m = (id) => request(s.port, 'POST', '/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'audit_summary', arguments: {} } }, ...as(id) });
    assert.ok((await m('tab-a')).json.result.structuredContent.total > (await m('tab-b')).json.result.structuredContent.total);
    for (const bad of ['UPPER', '../x', 'a b', '', '-lead', 'x'.repeat(33), '__proto__']) assert.equal((await request(s.port, 'GET', '/api/info', as(bad))).status, 400, JSON.stringify(bad));
  } finally { await s.close(); }
});

test('WORKSPACES: capped, the default is never evicted, the least recently used goes first', () => {
  let made = 0;
  const w = createWorkspaces({ defaultRuntime: { id: 'default' }, create: () => ({ id: ++made }), max: 3 });
  const a = w.get('a'); w.get('b');
  assert.equal(w.get('a'), a, 'same workspace, same runtime');
  w.get('c'); // evicts b (a was used more recently)
  assert.deepEqual(w.ids(), ['default', 'a', 'c']);
  for (let i = 0; i < 20; i++) w.get(`x${i}`);
  assert.equal(w.size, 3); assert.ok(w.ids().includes('default'));
  assert.equal(MAX_WORKSPACES, 50);
});

test('MODE: only mock exists; live is refused with an honest message and the server will not start; a bare MODE is never read', async () => {
  assert.equal(modeFrom({}), 'mock'); assert.equal(modeFrom({ AAT_LAB_MODE: 'mock' }), 'mock');
  assert.throws(() => modeFrom({ AAT_LAB_MODE: 'live' }), /Live mode is not available in this app/);
  for (const m of ['Mock', 'production', '1']) assert.throws(() => modeFrom({ AAT_LAB_MODE: m }), /mock mode only/, m);
  assert.equal(modeFrom({ MODE: 'live' }), 'mock', 'another app\'s MODE in the shared settings file must not switch this one');
  const freePort = await freeBase('guards', 1);
  let leaked = null; // if the mode check were missing the server would start: close it so a failing run cannot hang
  try { await assert.rejects(async () => { leaked = await startHttpServer({ port: freePort, env: { AAT_LAB_MODE: 'live' }, runtime: mkRuntime(), webDist: null }); }, /Live mode is not available/); } finally { await leaked?.close(); }
  assert.equal(allPassed(runChecks({ env: { AAT_LAB_MODE: 'live' } })), false);
  const port = await freeBase('guards', 1);
  const srv = await startHttpServer({ port, host: '127.0.0.1', env: {}, runtime: mkRuntime(), webDist: null });
  try {
    const info = (await request(srv.port, 'GET', '/api/info')).json;
    assert.equal(info.mode, 'mock'); assert.deepEqual(info.modes, { mock: true, live: false }); assert.equal(info.liveRefusal, LIVE_REFUSAL);
    assert.match(info.banner, /^SIMULATION, MOCK mode/); assert.equal('hosted' in info, false);
  } finally { await srv.close(); }
});

test('CUSTOMER CONFIG: bounded plain labels, bad values fall back, the shipped file is valid', () => {
  assert.deepEqual(normalizeCustomer(null), DEFAULT_CUSTOMER);
  const c = normalizeCustomer({ brand: { title: 'Acme Audit', tagline: 'x'.repeat(500) }, vocabulary: { agent: '<b>bot</b>', human: 'member' }, vertical: 'banking' });
  assert.equal(c.brand.title, 'Acme Audit'); assert.equal(c.brand.tagline, DEFAULT_CUSTOMER.brand.tagline);
  assert.equal(c.vocabulary.agent, 'agent', 'markup is refused'); assert.equal(c.vocabulary.human, 'member'); assert.equal(c.vertical, 'banking');
  assert.equal(normalizeCustomer({ brand: { title: 'a​b' } }).brand.title, DEFAULT_CUSTOMER.brand.title, 'hidden characters are refused');
  assert.equal(normalizeCustomer({ vertical: '__proto__' }).vertical, 'retail');
  const shipped = loadCustomer(); // reads customer.config.json (git-ignored); the defaults when it is absent
  assert.deepEqual(shipped, normalizeCustomer(shipped));
  assert.deepEqual(loadCustomer('/no/such/file.json'), DEFAULT_CUSTOMER);
});

// Behind the family lab-proxy (https://local.ping-devops.com:8443): Host is this lab's LAB_ALLOWED_HOSTS name with its port,
// the browser's Origin is the proxy's, and the proxy says so in X-Forwarded-Host/-Proto.
test('lab-proxy: LAB_ALLOWED_HOSTS parsing, launcher Host, proxied writes, and what stays refused', () => {
  assert.deepEqual([...parseAllowedHosts({})], []);
  assert.deepEqual([...parseAllowedHosts({ LAB_ALLOWED_HOSTS: ' Agent-Audit-Trail-Lab.local.ping-devops.com , ' })], ['agent-audit-trail-lab.local.ping-devops.com']);
  for (const bad of ['a.example:6600', 'https://a.example', 'a b']) assert.throws(() => parseAllowedHosts({ LAB_ALLOWED_HOSTS: bad }), /not a host name/);
  const name = 'agent-audit-trail-lab.local.ping-devops.com';
  const opts = { allowed: parseAllowedHosts({ LAB_ALLOWED_HOSTS: name }), port: 6600 };
  const hg = makeHostGuard(opts);
  const og = makeOriginGuard(opts);
  // launcher Host accepted; loopback still accepted
  assert.equal(run(hg, { host: `${name}:6600` }, 'GET').next, true);
  assert.equal(run(hg, { host: '127.0.0.1:6600' }, 'GET').next, true);
  // a Host outside the set is refused: the bare proxy name, another name, the right name on another port, no port; unset = loopback only
  for (const host of ['local.ping-devops.com:6600', 'local.ping-devops.com:8443', 'evil.example:6600', `${name}:6601`, name]) assert.equal(run(hg, { host }, 'GET').status, 421, host);
  assert.equal(run(hostGuard, { host: `${name}:6600` }, 'GET').status, 421);
  // proxied same-origin write accepted
  const proxied = { host: `${name}:6600`, 'x-forwarded-host': 'local.ping-devops.com:8443', 'x-forwarded-proto': 'https', 'sec-fetch-site': 'same-origin', 'content-length': '2', 'content-type': 'application/json' };
  assert.equal(run(og, { ...proxied, origin: 'https://local.ping-devops.com:8443' }).next, true);
  // foreign Origin refused, and an Origin that does not match the forwarded host or scheme
  for (const origin of ['https://evil.example', 'http://local.ping-devops.com:8443', 'https://local.ping-devops.com']) assert.equal(run(og, { ...proxied, origin }).status, 403, origin);
  assert.equal(run(og, { ...proxied, 'x-forwarded-proto': 'ftp', origin: 'ftp://local.ping-devops.com:8443' }).status, 403);
  assert.equal(run(og, { ...proxied, 'x-forwarded-host': '', origin: 'https://' }).status, 403);
  // forwarded headers on a loopback Host are ignored
  assert.equal(run(og, { ...proxied, host: '127.0.0.1:6600', origin: 'https://local.ping-devops.com:8443' }).status, 403);
  assert.equal(run(og, { ...proxied, host: 'localhost:6600', 'x-forwarded-host': 'evil.example', origin: 'https://evil.example' }).status, 403);
  // and without LAB_ALLOWED_HOSTS the proxy's origin is never believed
  assert.equal(run(originGuard, { ...proxied, origin: 'https://local.ping-devops.com:8443' }).status, 403);
});

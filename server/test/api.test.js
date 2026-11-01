import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { guardNetwork } from './netguard.js';
import { boot, mkRuntime, request } from './helpers.js';

const net = guardNetwork();
let srv; let port;
before(async () => { srv = await boot('api'); port = srv.port; });
after(async () => { await srv.close(); net.restore(); });
const get = (p, o) => request(port, 'GET', p, o);
const post = (p, body, o) => request(port, 'POST', p, { body, ...o });

test('health: demo-health/1, GET only', async () => {
  const r = await get('/api/health');
  assert.equal(r.status, 200); assert.equal(r.json.schema, 'demo-health/1'); assert.equal(r.json.state, 'ready'); assert.equal(r.json.runtime, 'offline');
  assert.equal((await post('/api/health', {})).status, 405);
});

test('info states the simulation, the retention provenance and the cap', async () => {
  const r = await get('/api/info');
  assert.equal(r.json.mode, 'mock'); assert.equal(r.json.simulated, true);
  assert.match(r.json.banner, /SIMULATION/); assert.match(r.json.retentionProvenance, /UNVERIFIED/); assert.equal(r.json.retentionDays, 7);
});

test('headers: nosniff, no-store, restrictive CSP on API responses, and no x-powered-by', async () => {
  const r = await get('/api/scenarios');
  assert.equal(r.headers['x-content-type-options'], 'nosniff'); assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(r.headers['content-security-policy'], "default-src 'none'"); assert.equal(r.headers['x-powered-by'], undefined);
});

test('scenarios: six, with resolved stories; running one returns ids that join', async () => {
  const list = await get('/api/scenarios');
  assert.equal(list.json.scenarios.length, 6);
  assert.ok(list.json.scenarios.every((s) => !/\{\{/.test(s.story)));
  const run = await post('/api/scenarios/two-hop-delegation/run', {});
  assert.equal(run.status, 200);
  const j = await get(`/api/join?traceId=${run.json.traceId}`);
  assert.equal(j.status, 200); assert.equal(j.json.delegation.chain.length, 2);
  assert.equal((await post('/api/scenarios/nope/run', {})).status, 404);
  assert.equal((await post('/api/scenarios/..%2f..%2fx/run', {})).status, 404);
  assert.equal((await post('/api/scenarios/normal-purchase/run', { traceId: 'x' })).status, 400);
});

test('search over REST: filters, clamp note and cursor', async () => {
  const r = await get('/api/events?days=30&limit=3');
  assert.equal(r.status, 200); assert.equal(r.json.clamped, true); assert.match(r.json.note, /clamped to 7 days/); assert.equal(r.json.events.length, 3);
  const next = await get(`/api/events?limit=3&cursor=${r.json.nextCursor}`);
  assert.equal(next.status, 200);
  assert.ok(!next.json.events.some((e) => r.json.events.some((x) => x.id === e.id)));
  assert.equal((await get('/api/events?limit=100000')).json.limit, 200);
  assert.equal((await get('/api/events?source=killswitch')).json.total, 1);
});

test('search rejects bad parameters with 400, never a 500', async () => {
  for (const q of ['days=abc', 'days=-1', 'days=0', 'limit=1.5', 'cursor=x', 'source=db', 'orphaned=maybe', 'traceId=zz', 'bogus=1', 'days=1&days=2', 'actor[]=x', `actor=${'x'.repeat(300)}`, 'eventType=%00']) {
    const r = await get(`/api/events?${q}`);
    assert.equal(r.status, 400, q);
    assert.equal(r.json.error, 'invalid_params');
  }
});

test('get one event, 404 for unknown, 400 for a malformed id', async () => {
  const first = (await get('/api/events?limit=1')).json.events[0].id;
  const r = await get(`/api/events/${first}`);
  assert.equal(r.status, 200); assert.ok(r.json.raw);
  assert.equal((await get('/api/events/ev-999999')).status, 404);
  assert.equal((await get('/api/events/not-an-id')).status, 400);
  assert.equal((await get('/api/events/%E0%A4%A')).status, 400);
});

test('summary', async () => {
  const r = await get('/api/events/summary?days=30');
  assert.equal(r.status, 200); assert.equal(r.json.clamped, true); assert.ok(r.json.total > 0);
});

test('READ-ONLY over REST: no write verb reaches any audit route', async () => {
  for (const p of ['/api/events', '/api/events/summary', '/api/events/ev-000001', '/api/join', '/api/chain/verify', '/api/chain', '/api/tools', '/api/retention-demo']) {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const r = await request(port, m, p, { body: m === 'DELETE' ? undefined : {} });
      assert.equal(r.status, 405, `${m} ${p}`);
      assert.equal(r.headers.allow, 'GET');
    }
  }
});

test('tools endpoint states the lesson and lists three tools', async () => {
  const r = await get('/api/tools');
  assert.equal(r.json.readOnly, true); assert.equal(r.json.tools.length, 3); assert.match(r.json.lesson, /exactly what is implemented/);
});

test('join: needs exactly one key; bad keys 400; unknown 404; by event id works', async () => {
  assert.equal((await get('/api/join')).status, 400);
  assert.equal((await get('/api/join?traceId=' + 'a'.repeat(32) + '&eventId=ev-000001')).status, 400);
  assert.equal((await get('/api/join?traceId=zz')).status, 400);
  assert.equal((await get('/api/join?traceId=' + 'a'.repeat(32))).status, 404);
  assert.equal((await get('/api/join?eventId=ev-999999')).status, 404);
  const seeded = (await get('/api/scenarios')).json.seeded[0].eventIds[0];
  assert.equal((await get(`/api/join?eventId=${seeded}`)).status, 200);
  assert.equal((await get('/api/join?eventId=ev-000001')).status, 404, 'ev-000001 is older than the retention window');
  assert.equal((await get('/api/join?other=1')).status, 400);
});

test('retention demo shows the silent-empty trap and the clamp', async () => {
  const r = await get('/api/retention-demo?days=30');
  assert.equal(r.json.naiveUpstream.count, 0); assert.equal(r.json.naiveUpstream.error, null);
  assert.ok(r.json.auditTool.count > 0); assert.equal(r.json.auditTool.clamped, true); assert.match(r.json.provenance, /UNVERIFIED/);
  assert.equal((await get('/api/retention-demo?days=0')).status, 400);
  assert.equal((await get('/api/retention-demo?days=9999')).status, 400);
  assert.equal((await get('/api/retention-demo')).json.requestedDays, 30);
});

test('chain: verify, list, and a tamper demo on a copy that leaves the live chain valid', async () => {
  assert.equal((await get('/api/chain/verify')).json.ok, true);
  const list = await get('/api/chain?limit=5');
  assert.equal(list.json.entries.length, 5); assert.match(list.json.entries[0].hash, /^[0-9a-f]{64}$/);
  assert.equal((await get('/api/chain?limit=9999')).status, 400);
  for (const kind of ['edit', 'edit-and-rehash', 'delete', 'insert', 'reorder', 'truncate']) {
    const r = await post('/api/chain/tamper-demo', { kind });
    assert.equal(r.status, 200, kind); assert.equal(r.json.after.ok, false, kind); assert.equal(r.json.realStoreTouched, false); assert.equal(r.json.liveStoreVerify.ok, true);
  }
  assert.equal((await post('/api/chain/tamper-demo', {})).json.kind, 'edit');
  assert.equal((await post('/api/chain/tamper-demo', { kind: 'drop-table' })).status, 400);
  assert.equal((await post('/api/chain/tamper-demo', { kind: 'edit', seq: -1 })).status, 400);
  assert.equal((await post('/api/chain/tamper-demo', { extra: 1 })).status, 400);
  assert.equal((await get('/api/chain/verify')).json.ok, true, 'still valid after all the demos');
});

test('guards: Host header must be loopback (421)', async () => {
  for (const host of ['evil.example', 'localhost.evil.example:6600', '0.0.0.0']) assert.equal((await get('/api/health', { host })).status, 421, host);
});

test('guards: credentials are refused, not ignored', async () => {
  for (const h of ['authorization', 'proxy-authorization', 'x-api-key']) {
    const r = await get('/api/events', { headers: { [h]: 'Bearer nope' } });
    assert.equal(r.status, 400); assert.equal(r.json.error, 'credentials_not_accepted');
  }
  assert.equal((await request(port, 'POST', '/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'ping' }, headers: { authorization: 'Bearer x' } })).status, 400);
});

test('guards: CSRF on every non-read route: cross-site, foreign Origin, non-JSON body', async () => {
  for (const p of ['/api/reset', '/api/scenarios/normal-purchase/run', '/api/chain/tamper-demo', '/mcp']) {
    assert.equal((await post(p, {}, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403, `cross-site ${p}`);
    assert.equal((await post(p, {}, { headers: { origin: 'http://evil.example' } })).status, 403, `origin ${p}`);
    assert.equal((await post(p, {}, { headers: { origin: 'null' } })).status, 403, `null origin ${p}`);
    assert.equal((await post(p, 'x=1', { headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status, 415, `form ${p}`);
    assert.equal((await post(p, 'plain', { headers: { 'content-type': 'text/plain' } })).status, 415, `text ${p}`);
  }
  const same = await post('/api/chain/tamper-demo', {}, { headers: { origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin' } });
  assert.equal(same.status, 200);
  assert.equal((await post('/api/chain/tamper-demo', {}, { headers: { origin: `http://127.0.0.1:${port + 1}` } })).status, 403, 'a different loopback port is a different origin');
});

test('bodies: malformed JSON is 400, oversize is 413, no stack or path leaks', async () => {
  const bad = await post('/api/reset', '{not json');
  assert.equal(bad.status, 400); assert.doesNotMatch(bad.raw, /at |node_modules|\/Users\//);
  const big = await post('/api/reset', { pad: 'x'.repeat(5000) });
  assert.equal(big.status, 413);
  assert.equal((await post('/api/reset', { a: 1 })).status, 400);
});

test('unknown routes and malformed paths are JSON 404/400, not HTML or 500', async () => {
  assert.equal((await get('/api/nope')).status, 404);
  assert.equal((await get('/nope')).status, 404);
  assert.ok([400, 404].includes((await get('/api/join?eventId=%E0%A4%A')).status));
  assert.equal((await get('/')).status, 404, 'no web build yet: JSON 404');
});

test('500s never leak: an unexpected tool failure is a bare server_error', async () => {
  const rt = mkRuntime();
  rt.tools = { list: () => [], call: () => { throw new Error('secret path /Users/someone/db.sqlite'); } };
  const s = await boot('api', rt);
  const origErr = console.error; console.error = () => {};
  try {
    const r = await request(s.port, 'GET', '/api/events');
    assert.equal(r.status, 500); assert.deepEqual(r.json, { error: 'server_error' }); assert.doesNotMatch(r.raw, /secret|Users|sqlite/);
    const m = await request(s.port, 'POST', '/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'audit_summary' } } });
    assert.equal(m.json.result.isError, true); assert.doesNotMatch(m.raw, /secret|Users|sqlite/);
  } finally { console.error = origErr; await s.close(); }
});

test('reset rebuilds the store, starts a new epoch and reports the discarded head', async () => {
  await post('/api/scenarios/normal-purchase/run', {});
  const before = (await get('/api/info')).json;
  const r = await post('/api/reset', {});
  assert.equal(r.status, 200); assert.equal(r.json.epoch, before.epoch + 1); assert.match(r.json.discardedHeadHash, /^[0-9a-f]{64}$/);
  const after = (await get('/api/info')).json;
  assert.ok(after.events < before.events);
  assert.equal((await get('/api/chain/verify')).json.ok, true);
});

test('the store cap is a 409, not a crash', async () => {
  const rt = mkRuntime();
  while (rt.store.size < rt.store.chain.cap - 3) rt.runScenario('normal-purchase');
  const s = await boot('api', rt);
  try {
    let status = 200;
    for (let i = 0; i < 3 && status === 200; i++) status = (await request(s.port, 'POST', '/api/scenarios/normal-purchase/run', { body: {} })).status;
    assert.equal(status, 409);
    assert.equal((await request(s.port, 'GET', '/api/chain/verify')).json.ok, true);
  } finally { await s.close(); }
});

test('zero non-loopback connections were attempted by any test above', () => {
  assert.deepEqual(net.attempts, []);
});

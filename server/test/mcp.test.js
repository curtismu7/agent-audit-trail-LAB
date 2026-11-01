import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { boot, request } from './helpers.js';

let srv; let port;
before(async () => { srv = await boot('mcp'); port = srv.port; });
after(async () => { await srv.close(); });
const rpc = (body, o) => request(port, 'POST', '/mcp', { body, ...o });
const call = (name, args, id = 1) => rpc({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

test('initialize, ping and the initialized notification', async () => {
  const i = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.equal(i.json.result.protocolVersion, '2025-06-18'); assert.deepEqual(i.json.result.capabilities, { tools: {} }); assert.equal(i.json.result.serverInfo.name, 'agent-audit-trail');
  assert.equal((await rpc({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } })).json.result.protocolVersion, '2025-06-18');
  assert.deepEqual((await rpc({ jsonrpc: '2.0', id: 3, method: 'ping' })).json.result, {});
  const n = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(n.status, 202); assert.equal(n.raw, '');
});

test('tools/list returns exactly three read-only tools', async () => {
  const r = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.deepEqual(r.json.result.tools.map((t) => t.name).sort(), ['audit_summary', 'get_audit_activity', 'search_audit_activities']);
});

test('tools/call search: content text and structuredContent agree; the clamp note travels in the result', async () => {
  const r = await call('search_audit_activities', { days: 30, limit: 2 });
  assert.equal(r.json.result.isError, false);
  const parsed = JSON.parse(r.json.result.content[0].text);
  assert.deepEqual(parsed, r.json.result.structuredContent);
  assert.equal(parsed.clamped, true); assert.match(parsed.note, /clamped to 7 days/); assert.equal(parsed.events.length, 2);
});

test('tools/call get and summary', async () => {
  const s = (await call('search_audit_activities', { limit: 1 })).json.result.structuredContent.events[0].id;
  assert.equal((await call('get_audit_activity', { activityId: s })).json.result.structuredContent.id, s);
  assert.ok((await call('audit_summary', {})).json.result.structuredContent.total > 0);
});

test('READ-ONLY over MCP: write-shaped tool names are protocol errors, and the store is unchanged', async () => {
  const sizeBefore = (await request(port, 'GET', '/api/info')).json.events;
  for (const name of ['create_audit_activity', 'delete_audit_activity', 'reset', 'append_audit', 'tamper_chain']) {
    const r = await call(name, {});
    assert.equal(r.json.error.code, -32602, name);
  }
  assert.equal((await request(port, 'GET', '/api/info')).json.events, sizeBefore);
});

test('tool-level failures come back inside the result with isError, not as transport errors', async () => {
  for (const [n, a] of [['get_audit_activity', { activityId: 'ev-999999' }], ['search_audit_activities', { days: 'many' }], ['search_audit_activities', { evil: 1 }], ['get_audit_activity', {}]]) {
    const r = await call(n, a);
    assert.equal(r.status, 200); assert.equal(r.json.result.isError, true); assert.match(r.json.result.content[0].text, /^audit tool failed:/);
  }
});

test('JSON-RPC hygiene: unknown method, batch, wrong version, bad id, bad JSON, oversize, wrong verb', async () => {
  assert.equal((await rpc({ jsonrpc: '2.0', id: 1, method: 'resources/list' })).json.error.code, -32601);
  assert.equal((await rpc([{ jsonrpc: '2.0', id: 1, method: 'ping' }])).json.error.code, -32600);
  assert.equal((await rpc({ jsonrpc: '1.0', id: 1, method: 'ping' })).json.error.code, -32600);
  assert.equal((await rpc({ jsonrpc: '2.0', id: { a: 1 }, method: 'ping' })).json.error.code, -32600);
  assert.equal((await rpc({ jsonrpc: '2.0', id: 1 })).json.error.code, -32600);
  assert.ok([-32600, -32700].includes((await rpc('null')).json.error.code));
  const bad = await rpc('{nope');
  assert.equal(bad.status, 400); assert.equal(bad.json.error.code, -32700);
  const big = await rpc({ jsonrpc: '2.0', id: 1, method: 'ping', params: { pad: 'x'.repeat(10000) } });
  assert.equal(big.status, 413);
  for (const m of ['GET', 'PUT', 'DELETE']) { const r = await request(port, m, '/mcp'); assert.equal(r.status, 405, m); assert.equal(r.headers.allow, 'POST'); }
});

test('the MCP endpoint serves the new store after a reset', async () => {
  const before = (await call('audit_summary', {})).json.result.structuredContent.total;
  await request(port, 'POST', '/api/scenarios/normal-purchase/run', { body: {} });
  assert.ok((await call('audit_summary', {})).json.result.structuredContent.total > before);
  await request(port, 'POST', '/api/reset', { body: {} });
  assert.equal((await call('audit_summary', {})).json.result.structuredContent.total, before);
});

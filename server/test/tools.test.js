import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TOOLS, ToolError, createTools, validateArgs } from '../src/tools.js';
import { mkRuntime } from './helpers.js';

const WRITE_WORDS = /(create|write|delete|remove|update|set|put|post|append|insert|reset|tamper|edit|purge|clear|kill|approve)/i;

test('READ-ONLY: exactly the three audit tools exist and none of them is a write', () => {
  assert.deepEqual(TOOLS.map((t) => t.name).sort(), ['audit_summary', 'get_audit_activity', 'search_audit_activities']);
  for (const t of TOOLS) {
    assert.doesNotMatch(t.name, WRITE_WORDS, t.name);
    assert.equal(t.inputSchema.type, 'object'); assert.equal(t.inputSchema.additionalProperties, false);
    assert.ok(t.description.length > 20);
  }
});

test('READ-ONLY: every plausible write tool name is an unknown tool', () => {
  const rt = mkRuntime();
  for (const n of ['create_audit_activity', 'delete_audit_activity', 'append_audit', 'reset', 'tamper', 'update_audit_activity', 'write', '__proto__', 'constructor', 'toString', '', undefined, 42, null]) {
    assert.throws(() => rt.tools.call(n, {}), (e) => e instanceof ToolError && e.code === 'unknown_tool', String(n));
  }
});

test('READ-ONLY: the tools are built over a view that has no append, chain, ingest or reset', () => {
  const rt = mkRuntime();
  const view = rt.store.view;
  assert.deepEqual(Object.keys(view).sort(), ['get', 'retentionDays', 'search', 'summary', 'windowEvents']);
  assert.ok(Object.isFrozen(view));
  for (const k of ['ingest', 'append', 'chain', 'reset', 'delete', 'update']) assert.equal(view[k], undefined, k);
});

test('READ-ONLY: running every tool leaves the chain head and size unchanged', () => {
  const rt = mkRuntime();
  const before = { head: rt.store.chain.head.hash, size: rt.store.size };
  rt.tools.call('search_audit_activities', { days: 30, limit: 500 });
  rt.tools.call('audit_summary', {});
  rt.tools.call('get_audit_activity', { activityId: rt.seeded[0].eventIds[0] });
  try { rt.tools.call('get_audit_activity', { activityId: 'ev-999999' }); } catch { /* expected */ }
  assert.deepEqual({ head: rt.store.chain.head.hash, size: rt.store.size }, before);
});

test('arguments are validated against the schema: unknown keys, wrong types, bad formats', () => {
  const rt = mkRuntime();
  const bad = [
    ['search_audit_activities', { admin: true }], ['search_audit_activities', { days: '7' }], ['search_audit_activities', { days: 0 }], ['search_audit_activities', { days: 1.5 }],
    ['search_audit_activities', { limit: -1 }], ['search_audit_activities', { source: 'nope' }], ['search_audit_activities', { traceId: 'XYZ' }], ['search_audit_activities', { cursor: 'drop table' }],
    ['search_audit_activities', { actor: 'a b' }], ['search_audit_activities', { actor: 'x'.repeat(500) }], ['search_audit_activities', { orphaned: 'yes' }], ['search_audit_activities', 'x'], ['search_audit_activities', []],
    ['get_audit_activity', {}], ['get_audit_activity', { activityId: '../etc/passwd' }], ['get_audit_activity', { activityId: 'ev-1' }], ['audit_summary', { days: 'all' }],
  ];
  for (const [n, a] of bad) assert.throws(() => rt.tools.call(n, a), (e) => e instanceof ToolError && e.code === 'invalid_params', `${n} ${JSON.stringify(a)}`);
  assert.deepEqual(validateArgs(TOOLS[2], undefined), {});
});

test('search through the tool clamps days and limit and says so', () => {
  const r = mkRuntime().tools.call('search_audit_activities', { days: 90, limit: 9999 });
  assert.equal(r.windowDays, 7); assert.equal(r.clamped, true); assert.equal(r.limit, 200); assert.match(r.note, /clamped to 7 days/);
});

test('get returns the full envelope with the inert raw record; a missing id is not_found', () => {
  const rt = mkRuntime();
  const e = rt.tools.call('get_audit_activity', { activityId: rt.seeded[0].eventIds[0] });
  assert.ok(e.raw && e.id && e.recordedAt);
  assert.throws(() => rt.tools.call('get_audit_activity', { activityId: 'ev-999999' }), (x) => x.code === 'not_found');
});

test('createTools refuses the store itself: only the frozen read-only view is accepted', () => {
  const rt = mkRuntime();
  assert.throws(() => createTools(rt.store), /read-only view/);
  assert.throws(() => createTools({ search() {}, get() {}, summary() {} }), /read-only view/, 'an unfrozen object is refused');
  assert.throws(() => createTools(Object.freeze({ search() {}, ingest() {} })), /read-only view/);
  const t = createTools(Object.freeze({ search: () => ({ ok: 1 }), get: () => null, summary: () => ({ ok: 2 }) }));
  assert.deepEqual(t.call('audit_summary', {}), { ok: 2 });
});

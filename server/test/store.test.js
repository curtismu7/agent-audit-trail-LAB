import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStore, DAY_MS, MAX_LIMIT, RETENTION_DAYS } from '../src/store.js';
import { gatewayLog } from '../src/sources.js';
import { NOW, mkRuntime } from './helpers.js';

const key = Buffer.alloc(32, 5);
function storeWith(daysAgo, { now = NOW } = {}) {
  const s = createStore({ now: () => now, key });
  daysAgo.forEach((d, i) => {
    const m = gatewayLog({ id: `g${i}`, at: new Date(now.getTime() - d * DAY_MS), phase: 'decision', tool: 't.x', decision: 'allow', agentId: 'agent-a', scopes: [], latencyMs: 1 });
    s.ingest(m.source, m.raw);
  });
  return s;
}

test('RETENTION: a window past retention is clamped AND the result says so', () => {
  const s = storeWith([1, 2, 6, 9, 20]);
  const r = s.search({ days: 30 });
  assert.equal(r.windowDays, RETENTION_DAYS);
  assert.equal(r.requestedDays, 30);
  assert.equal(r.clamped, true);
  assert.match(r.note, /clamped to 7 days/);
  assert.match(r.note, /UNVERIFIED/);
  assert.equal(r.total, 3, 'only the three events inside 7 days');
  const sum = s.summary({ days: 365 });
  assert.equal(sum.clamped, true); assert.match(sum.note, /clamped to 7 days/); assert.equal(sum.total, 3);
});

test('RETENTION: a window inside retention is honoured and not flagged', () => {
  const s = storeWith([1, 2, 6]);
  const r = s.search({ days: 3 });
  assert.equal(r.windowDays, 3); assert.equal(r.clamped, false); assert.equal(r.note, null); assert.equal(r.total, 2);
  const d = s.search();
  assert.equal(d.windowDays, 7); assert.equal(d.clamped, false);
});

test('SILENT-EMPTY TRAP: the raw upstream answers zero events beyond retention with no error; the tool does not', () => {
  const s = storeWith([1, 2, 6, 9]);
  assert.equal(s.upstreamQuery(7).length, 3);
  assert.equal(s.upstreamQuery(30).length, 0, 'the trap: 30 days looks fine and returns nothing');
  const demo = s.retentionDemo(30);
  assert.equal(demo.naiveUpstream.count, 0); assert.equal(demo.naiveUpstream.error, null);
  assert.equal(demo.auditTool.count, 3); assert.equal(demo.auditTool.clamped, true);
  assert.equal(demo.storedBeyondRetention, 1);
  assert.match(demo.provenance, /UNVERIFIED/);
  const within = s.retentionDemo(5);
  assert.equal(within.naiveUpstream.count, within.auditTool.count);
  assert.equal(within.auditTool.clamped, false);
});

test('an event older than retention is not found by id either (the upstream cannot see it)', () => {
  const s = storeWith([9, 1]);
  assert.equal(s.get('ev-000001'), null);
  assert.equal(s.get('ev-000002').id, 'ev-000002');
  assert.equal(s.get('ev-999999'), null);
});

test('PAGINATION CAPS: limit is clamped to the maximum and the clamp is stated', () => {
  const s = storeWith(Array.from({ length: 260 }, (_, i) => 0.001 * (i + 1)));
  const r = s.search({ limit: 100000 });
  assert.equal(r.limit, MAX_LIMIT); assert.equal(r.count, MAX_LIMIT); assert.equal(r.total, 260);
  assert.match(r.note, /limit clamped to 200/);
  assert.ok(r.nextCursor);
  assert.equal(s.search({ limit: 1 }).count, 1);
  assert.equal(s.search({ limit: 0 }).limit, 1, 'a zero limit is raised to one');
  assert.equal(s.search().limit, 50, 'default page size');
});

test('pagination: following nextCursor visits every event once, newest first, and ends with a null cursor', () => {
  const s = storeWith(Array.from({ length: 23 }, (_, i) => 0.01 * (i + 1)));
  const seen = []; let cursor; let pages = 0;
  do {
    const r = s.search({ limit: 5, cursor });
    seen.push(...r.events.map((e) => e.id)); cursor = r.nextCursor ?? undefined; pages += 1;
  } while (cursor && pages < 20);
  assert.equal(pages, 5); assert.equal(seen.length, 23); assert.equal(new Set(seen).size, 23);
  const times = seen.map((id) => Date.parse(s.get(id).recordedAt));
  assert.deepEqual([...times].sort((a, b) => b - a), times);
});

test('pagination: events with identical timestamps are neither skipped nor repeated across pages', () => {
  const s = createStore({ now: () => NOW, key });
  for (let i = 0; i < 12; i++) { const m = gatewayLog({ id: `g${i}`, at: new Date(NOW.getTime() - 1000), phase: 'decision', tool: 't', decision: 'allow', agentId: 'a', scopes: [], latencyMs: 1 }); s.ingest(m.source, m.raw); }
  const ids = []; let cursor;
  do { const r = s.search({ limit: 5, cursor }); ids.push(...r.events.map((e) => e.id)); cursor = r.nextCursor ?? undefined; } while (cursor);
  assert.equal(new Set(ids).size, 12);
});

test('filters are exact and AND-ed; orphaned means no trace id', () => {
  const rt = mkRuntime();
  const s = rt.store;
  assert.ok(s.search({ source: 'killswitch' }).events.every((e) => e.source === 'killswitch'));
  assert.equal(s.search({ source: 'killswitch' }).total, 1);
  assert.ok(s.search({ decision: 'deny' }).total >= 2);
  assert.ok(s.search({ orphaned: true }).events.every((e) => e.traceId === null));
  assert.ok(s.search({ orphaned: false }).events.every((e) => e.traceId !== null));
  assert.equal(s.search({ actor: 'agent-purchasing', source: 'policy' }).events.every((e) => e.actor === 'agent-purchasing' && e.source === 'policy'), true);
  assert.equal(s.search({ actor: 'agent-nobody' }).total, 0);
  assert.equal(s.search({ eventType: 'gateway.decision' }).events.every((e) => e.type === 'gateway.decision'), true);
});

test('summary counts add up and report traces and orphans', () => {
  const s = mkRuntime().store;
  const sum = s.summary();
  assert.equal(Object.values(sum.byType).reduce((a, b) => a + b, 0), sum.total);
  assert.equal(Object.values(sum.bySource).reduce((a, b) => a + b, 0), sum.total);
  assert.ok(sum.traces >= 5); assert.ok(sum.orphaned >= 1);
});

test('ingest refuses garbage without storing it and counts the rejection', () => {
  const s = createStore({ now: () => NOW, key });
  assert.throws(() => s.ingest('gateway', { time: 'never' }));
  assert.equal(s.size, 0); assert.equal(s.rejected, 1);
});

test('results handed out are copies: editing one does not change the store', () => {
  const s = mkRuntime().store;
  const first = s.search({ limit: 1 }).events[0];
  first.actor = 'agent-forged';
  const e = s.get(first.id); e.actor = 'agent-forged';
  assert.notEqual(s.get(first.id).actor, 'agent-forged');
  assert.equal(s.chain.verify().ok, true);
});

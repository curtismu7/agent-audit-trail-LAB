// Mutation pins from the AT2 fix pass: each test here fails if the named behaviour is loosened. No ports, no sleeps.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChain } from '../src/chain.js';
import { createJoin, describe, MAX_FACTS, RELATED_WINDOW_MS } from '../src/join.js';

// Literal windows on purpose: a test that imported the constants would move with a mutated constant.
const SESSION_BEFORE_MS = 3_600_000; const SESSION_AFTER_MS = 600_000;
import { MAX_HOPS, MAX_MS, MIN_MS, BadEvent, normalize, toIso } from '../src/normalize.js';
import { RANGES, inertValue, revealText } from '../src/sanitize.js';
import { gatewayLog, idpSignin, killEvent, tokenEvent } from '../src/sources.js';
import { createStore, DAY_MS, DEFAULT_LIMIT } from '../src/store.js';
import { NOW } from './helpers.js';

const key = Buffer.alloc(32, 9);
const T = (ms) => new Date(NOW.getTime() - ms);
const TR = 'ab'.repeat(16); const SP = 'cd'.repeat(8);
const trace = { traceId: TR, spanId: SP };
const newStore = () => createStore({ now: () => NOW, key });
const ingest = (s, m) => s.ingest(m.source, m.raw);
const gw = (o) => gatewayLog({ phase: 'decision', tool: 't.x', decision: 'allow', agentId: 'agent-a', scopes: [], latencyMs: 1, ...o });

// ---- retention clamp boundary
test('RETENTION boundary: 6 and 7 are honoured, 8 and 9 are clamped and say so', () => {
  const s = newStore();
  for (const [days, clamped] of [[6, false], [7, false], [8, true], [9, true]]) {
    const r = s.search({ days });
    assert.equal(r.clamped, clamped, `days=${days}`);
    assert.equal(r.windowDays, Math.min(days, 7));
    assert.equal(r.note === null, !clamped, `days=${days} note`);
    if (clamped) assert.match(r.note, /clamped to 7 days \(requested /);
    assert.equal(s.summary({ days }).clamped, clamped);
  }
});

// ---- search filters and cursor edges
function filterStore() {
  const s = newStore();
  ingest(s, gw({ id: 'g1', at: T(5000), decision: 'allow', trace, sid: 's1' }));
  ingest(s, gw({ id: 'g2', at: T(4000), decision: 'deny', trace: { traceId: 'ef'.repeat(16), spanId: SP }, sid: 's1' }));
  ingest(s, gw({ id: 'g3', at: T(3000), decision: 'pause' }));
  return s;
}
test('search: the decision filter narrows, and a filter is never silently ignored', () => {
  const s = filterStore();
  assert.deepEqual(s.search({ decision: 'deny' }).events.map((e) => e.decision), ['deny']);
  assert.equal(s.search({ decision: 'pause' }).total, 1);
  assert.equal(s.search({ decision: 'nope' }).total, 0);
});
test('search: the traceId filter narrows', () => {
  const s = filterStore();
  const r = s.search({ traceId: TR });
  assert.equal(r.total, 1); assert.equal(r.events[0].traceId, TR);
  assert.equal(s.search({ traceId: '00'.repeat(15) + '01' }).total, 0);
});
test('search: the last page of exactly `limit` rows hands out no cursor, and a partial page is followed by one', () => {
  const s = newStore();
  for (let i = 0; i < 4; i++) ingest(s, gw({ id: `g${i}`, at: T(1000 * (4 - i)) }));
  assert.equal(s.search({ limit: 4 }).nextCursor, null, 'exactly limit rows: nothing follows');
  const p1 = s.search({ limit: 3 });
  assert.ok(p1.nextCursor);
  const p2 = s.search({ limit: 3, cursor: p1.nextCursor });
  assert.equal(p2.count, 1); assert.equal(p2.nextCursor, null);
  const p3 = s.search({ limit: 1, cursor: s.search({ limit: 3 }).nextCursor });
  assert.equal(p3.count, 1); assert.equal(p3.nextCursor, null, 'one row left and limit 1');
  assert.equal(s.search({}).limit, DEFAULT_LIMIT);
});
test('search: the window edge is exclusive (an event exactly 7 days old is outside)', () => {
  const s = newStore();
  ingest(s, gw({ id: 'edge', at: T(7 * DAY_MS) }));
  ingest(s, gw({ id: 'in', at: T(7 * DAY_MS - 1) }));
  const r = s.search({ days: 7 });
  assert.equal(r.total, 1); assert.equal(r.events[0].id, 'ev-000002');
  assert.equal(s.summary({ days: 7 }).total, 1);
});

// ---- delegation chain honesty
const nest = (n) => { let act = { sub: 'h0' }; for (let i = 1; i < n; i++) act = { sub: `h${i}`, act }; return act; };
const exch = (act, o = {}) => tokenEvent({ id: 'x1', at: T(5000), kind: 'token.exchanged', sub: 'user-a', clientId: 'c', clientName: 'C', aud: 'a.example', scope: ['s'], act, trace, jti: 'j', ...o });
const cycle = () => { const c = { sub: 'agent-a' }; c.act = c; return c; };
test('delegation: a cycle is cut at the first repeat and FLAGGED', () => {
  const e = normalize('token', exch(cycle()).raw);
  assert.deepEqual(e.delegation, ['agent-a']);
  assert.ok(e.flags.includes('delegation-cycle'));
  const mixed = { sub: 'b', act: { sub: 'a', act: { sub: 'b' } } };
  assert.ok(normalize('token', exch(mixed).raw).flags.includes('delegation-cycle'));
});
test('delegation: exactly MAX_HOPS is complete, one more is flagged truncated', () => {
  const ok = normalize('token', exch(nest(MAX_HOPS)).raw);
  assert.equal(ok.delegation.length, MAX_HOPS); assert.deepEqual(ok.flags.filter((f) => f.startsWith('delegation')), []);
  const over = normalize('token', exch(nest(MAX_HOPS + 1)).raw);
  assert.equal(over.delegation.length, MAX_HOPS); assert.ok(over.flags.includes('delegation-truncated'));
  assert.ok(normalize('token', exch(nest(12)).raw).flags.includes('delegation-truncated'));
});
test('delegation: the join turns a cycle or truncation into a visible gap', () => {
  for (const [act, id] of [[cycle(), 'delegation-cycle'], [nest(12), 'delegation-truncated']]) {
    const s = newStore(); ingest(s, exch(act)); ingest(s, gw({ id: 'g', at: T(4000), trace }));
    const j = createJoin(s.view).byTrace(TR);
    assert.ok(j.gaps.some((g) => g.id === id), id);
  }
  const s = newStore(); ingest(s, exch({ sub: 'agent-a' })); ingest(s, gw({ id: 'g', at: T(4000), trace }));
  assert.ok(!createJoin(s.view).byTrace(TR).gaps.some((g) => g.id.startsWith('delegation-')), 'a clean chain has no such gap');
});

// ---- token exchange: the current actor is the OUTERMOST act
test('token.exchanged actor is the current (outermost) actor, not the oldest delegate', () => {
  const e = normalize('token', exch({ sub: 'agent-sub', act: { sub: 'agent-orch' } }).raw);
  assert.equal(e.actor, 'agent-sub');
  assert.deepEqual(e.delegation, ['agent-orch', 'agent-sub']);
  const s = newStore(); ingest(s, exch({ sub: 'agent-sub', act: { sub: 'agent-orch' } }));
  assert.equal(s.search({ actor: 'agent-sub' }).total, 1);
  assert.equal(s.search({ actor: 'agent-orch' }).total, 0);
});

// ---- normalizer details
test('a hidden character in a decision shows as the documented [U+XXXX] marker, upper-case hex', () => {
  const n = normalize('gateway', { log_id: 'g', time: T(1000).toISOString(), phase: 'decision', tool: 't', decision: 'ALLOW​', agent_id: 'a' });
  assert.equal(n.decision.result, 'allow[U+200B]');
});
test('timestamps: far-future, negative and malformed are refused', () => {
  assert.throws(() => toIso(4e15), BadEvent);
  assert.throws(() => toIso(-1), BadEvent);
  assert.throws(() => toIso(MIN_MS - 1), BadEvent);
  assert.throws(() => toIso(MAX_MS + 1), BadEvent);
  assert.equal(toIso(MIN_MS), '2000-01-01T00:00:00.000Z');
  assert.throws(() => toIso('yesterday'), BadEvent);
  assert.throws(() => toIso('2026-10-21T12:00:00.000Z; DROP'), BadEvent);
  assert.throws(() => toIso('1234'), BadEvent);
});
test('token scopes and raw object keys are bounded', () => {
  const many = Array.from({ length: 100 }, (_, i) => `s${i}`);
  assert.equal(normalize('token', exch(undefined, { scope: many }).raw).scopes.length, 30);
  assert.equal(Object.keys(inertValue(Object.fromEntries(many.map((k) => [k, 1])))).length, 50);
});

// ---- inert text: probe an independent list of code points, not the module's own table
const ch = (n) => String.fromCodePoint(n);
test('inert text reveals every declared invisible range, including the tag block, C1 controls and the BOM', () => {
  const probes = [0xAD, 0x34F, 0x61C, 0x115F, 0x1160, 0x17B4, 0x180B, 0x180F, 0x200B, 0x200F, 0x202A, 0x202E, 0x2060, 0x206F, 0x2800, 0x3164,
    0xFE00, 0xFE0D, 0xFEFF, 0xFFA0, 0xFFF9, 0xFFFB, 0x2028, 0x2029, 0x1D173, 0x1D17A, 0xE0000, 0xE0041, 0xE007F, 0xE0100, 0xE01EF,
    0x00, 0x07, 0x0B, 0x0C, 0x0E, 0x1F, 0x7F, 0x80, 0x85, 0x9F];
  for (const cp of probes) {
    assert.equal(revealText(`a${ch(cp)}b`), `a[U+${cp.toString(16).toUpperCase().padStart(4, '0')}]b`, `U+${cp.toString(16)}`);
  }
  for (const cp of [0x09, 0x0A, 0x0D, 0x20, 0x41, 0xA0, 0xA1, 0xFE0E, 0xFE0F, 0x2027, 0x200A, 0xE00FF, 0xE01F0]) assert.equal(revealText(`a${ch(cp)}b`), `a${ch(cp)}b`, `U+${cp.toString(16)} stays as is`);
  for (const [a, b = a] of RANGES) { assert.notEqual(revealText(ch(a)), ch(a)); assert.notEqual(revealText(ch(b)), ch(b)); }
});

// ---- hash chain: every MAC input is pinned
test('chain: editing only a stored timestamp is detected as hash_mismatch', () => {
  const c = createChain({ key, now: () => NOW }); for (let i = 0; i < 4; i++) c.append({ i });
  const copy = c.snapshot(); copy[1].at = '1999-01-01T00:00:00.000Z';
  const v = c.verifyEntries(copy);
  assert.equal(v.ok, false); assert.equal(v.reason, 'hash_mismatch'); assert.equal(v.firstBadSeq, 2);
  const t = c.tamperDemo('edit-timestamp', 2);
  assert.equal(t.after.reason, 'hash_mismatch'); assert.equal(t.after.firstBadSeq, 2); assert.equal(t.change.field, 'at');
});
test('chain: the same event at another position or after another predecessor hashes differently (seq and prevHash are in the MAC)', () => {
  const a = createChain({ key, now: () => NOW }); a.append({ i: 0 }); a.append({ i: 1 });
  const b = createChain({ key, now: () => NOW }); b.append({ i: 99 }); b.append({ i: 1 });
  assert.notEqual(a.snapshot()[1].hash, b.snapshot()[1].hash, 'different prevHash');
  // Forge: relabel entry 2 as seq 1 / prevHash GENESIS with its own hash kept: the MAC no longer matches.
  const forged = a.snapshot().slice(1); forged[0].seq = 1; forged[0].prevHash = a.snapshot()[0].prevHash;
  assert.equal(a.verifyEntries(forged, { seq: 1, hash: forged[0].hash }).reason, 'hash_mismatch', 'seq/prevHash changed, hash kept');
});
test('chain: append stores a copy, not the caller\'s object', () => {
  const c = createChain({ key, now: () => NOW }); const ev = { id: 'x', actor: 'a' };
  c.append(ev); ev.actor = 'forged';
  assert.equal(c.list()[0].event.actor, 'a'); assert.equal(c.verify().ok, true);
});

// ---- join: windows, routing, labels
const sign = (id, at) => idpSignin({ id, at, user: { id: 'user-a', name: 'A' }, client: { id: 'c', name: 'C' }, sid: 'sess' });
const kill = (id, at) => killEvent({ id, at, agentId: 'agent-a', operator: { id: 'op', name: 'Op' }, reason: 'r', sid: 'sess' });
function sessionStore(extra) {
  const s = newStore();
  ingest(s, gw({ id: 'core', at: T(60_000), trace, sid: 'sess' }));
  extra(s);
  return s;
}
test('session inference: the before-window edge is inclusive, one ms further is out', () => {
  const t0 = NOW.getTime() - 60_000;
  const s = sessionStore((st) => { ingest(st, sign('in-edge', new Date(t0 - SESSION_BEFORE_MS))); ingest(st, sign('out-edge', new Date(t0 - SESSION_BEFORE_MS - 1))); });
  const j = createJoin(s.view).byTrace(TR);
  assert.deepEqual(j.timeline.map((e) => e.id), ['ev-000002', 'ev-000001'], 'only the edge sign-in joined, before the core event');
  assert.equal(j.timeline[0].link, 'session-inferred'); assert.equal(j.timeline[1].link, 'trace');
});
test('session inference: the after-window edge is inclusive, one ms further is out', () => {
  const s = newStore();
  const core = new Date(NOW.getTime() - 20 * 60_000);
  ingest(s, gw({ id: 'core', at: core, trace, sid: 'sess' }));
  ingest(s, kill('k-in', new Date(core.getTime() + SESSION_AFTER_MS)));
  ingest(s, kill('k-out', new Date(core.getTime() + SESSION_AFTER_MS + 1)));
  const j = createJoin(s.view).byTrace(TR);
  assert.deepEqual(j.timeline.map((e) => e.id), ['ev-000001', 'ev-000002']);
  assert.equal(j.timeline[1].link, 'session-inferred');
});
test('session inference never pulls in an event that has its own trace id, or another session', () => {
  const s = sessionStore((st) => {
    ingest(st, gw({ id: 'other-trace', at: T(59_000), trace: { traceId: 'ef'.repeat(16), spanId: SP }, sid: 'sess' }));
    ingest(st, idpSignin({ id: 'other-sess', at: T(61_000), user: { id: 'u', name: 'U' }, client: { id: 'c', name: 'C' }, sid: 'different' }));
  });
  assert.equal(createJoin(s.view).byTrace(TR).timeline.length, 1);
});
test('byEvent: a traced event WITHOUT a session id still routes to its trace, never to orphan', () => {
  const s = newStore();
  ingest(s, gw({ id: 'a', at: T(5000), trace })); ingest(s, gw({ id: 'b', at: T(4000), trace, decision: 'deny' }));
  const j = createJoin(s.view).byEvent('ev-000002');
  assert.equal(j.orphan, false); assert.equal(j.traceId, TR); assert.equal(j.timeline.length, 2); assert.equal(j.focusEventId, 'ev-000002');
});
test('orphan: labelled seed, and possiblyRelated is the same actor within the window only', () => {
  const s = newStore();
  const t0 = T(10 * 60_000).getTime();
  ingest(s, gw({ id: 'orphan', at: new Date(t0) }));
  ingest(s, gw({ id: 'same-near', at: new Date(t0 + RELATED_WINDOW_MS) }));
  ingest(s, gw({ id: 'same-far', at: new Date(t0 + RELATED_WINDOW_MS + 1) }));
  ingest(s, gw({ id: 'other-actor', at: new Date(t0 + 1000), agentId: 'agent-z' }));
  const j = createJoin(s.view).byEvent('ev-000001');
  assert.equal(j.orphan, true); assert.equal(j.timeline[0].link, 'seed');
  assert.deepEqual(j.possiblyRelated.map((r) => r.id), ['ev-000002']);
  assert.ok(j.possiblyRelated.every((r) => r.joined === false));
});

// ---- the sentence never states an inference as plain fact
test('the sentence and facts qualify a sign-in that is linked by session id only', () => {
  const s = sessionStore((st) => ingest(st, sign('si', T(120_000))));
  const j = createJoin(s.view).byTrace(TR);
  assert.match(j.sentence, /signed in \(linked by session id only, an inference\)/);
  assert.match(j.facts[0].text, /linked by session id only/);
  const idp = j.hops.find((h) => h.hop === 'identity');
  assert.equal(idp.present, true); assert.equal(idp.inferredOnly, true);
  assert.equal(j.hops.find((h) => h.hop === 'gateway').inferredOnly, false);
});
test('a sign-in that is not inferred is stated plainly', () => {
  const ev = { id: 'ev-1', type: 'auth.signin', subject: 'user-a', subjectName: 'A', actor: null, delegation: [], recordedAt: T(1).toISOString(), flags: [] };
  assert.match(describe([ev]).sentence, /^A \(user-a\) signed in\.$/);
  assert.match(describe([ev], new Set(['ev-1'])).sentence, /signed in \(linked by session id only, an inference\)\.$/);
});
test('the sentence stays bounded on a very large trace', () => {
  const s = newStore();
  for (let i = 0; i < 120; i++) ingest(s, gw({ id: `g${i}`, at: new Date(NOW.getTime() - 200_000 + i * 1000), trace, decision: i % 2 ? 'deny' : 'allow' }));
  const j = createJoin(s.view).byTrace(TR);
  assert.ok(j.facts.length <= MAX_FACTS + 2, `facts=${j.facts.length}`);
  assert.match(j.sentence, /further event\(s\) in this timeline are not described here/);
  assert.ok(j.sentence.length < 6000);
  assert.equal(j.timeline.length, 120, 'the timeline itself is complete');
});

test('normalizer: non-objects, other date formats and bad trace ids are refused or flagged', () => {
  assert.throws(() => normalize('gateway', [{}]), BadEvent);
  assert.throws(() => normalize('gateway', 'x'), BadEvent);
  const arrayWithFields = Object.assign([], { log_id: 'g', time: T(1000).toISOString(), phase: 'decision', tool: 't', decision: 'allow', agent_id: 'a' });
  assert.throws(() => normalize('gateway', arrayWithFields), BadEvent, 'an array is not an event even if it carries the fields');
  assert.throws(() => normalize('nope', {}), BadEvent);
  assert.throws(() => toIso('2026-10-21'), BadEvent, 'date only');
  assert.throws(() => toIso('Oct 21, 2026 12:00:00 UTC'), BadEvent);
  assert.throws(() => toIso(NaN), BadEvent);
  const n = normalize('hitl', { approval_id: 'a', at: T(1000).toISOString(), state: 'requested', request: {}, trace_id: 'nothex', sid: 's' });
  assert.equal(n.traceId, null); assert.ok(n.flags.includes('invalid-trace-id'));
});

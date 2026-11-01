import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJoin, describe } from '../src/join.js';
import { createRng } from '../src/rng.js';
import { runScenario, seedAll } from '../src/scenarios.js';
import { createStore, DAY_MS } from '../src/store.js';
import { gatewayLog, idpSignin, killEvent, tokenEvent } from '../src/sources.js';
import { NOW, mkRuntime } from './helpers.js';

const key = Buffer.alloc(32, 1);
const fresh = (id) => {
  const store = createStore({ now: () => NOW, key });
  const run = runScenario(store, id, { rng: createRng(5), start: new Date(NOW.getTime() - 10 * 60_000) });
  return { store, run };
};
// Rebuild a store from a scenario's envelopes minus the ones `drop` selects: a missing hop.
function without(id, drop) {
  const { store, run } = fresh(id);
  const copy = createStore({ now: () => NOW, key });
  for (const e of store.all()) if (!drop(e)) copy.ingest(e.source, e.raw);
  return { join: createJoin(copy.view), traceId: run.traceId, store: copy };
}
const gapIds = (j) => j.gaps.map((g) => g.id);
const hopsPresent = (j) => j.hops.filter((h) => h.present).map((h) => h.hop);

test('normal purchase: full timeline, complete hops, no gaps, a sentence from its fields', () => {
  const { store, run } = fresh('normal-purchase');
  const j = createJoin(store.view).byTrace(run.traceId);
  assert.equal(j.found, true); assert.equal(j.orphan, false);
  assert.deepEqual(hopsPresent(j), ['identity', 'token', 'gateway', 'policy', 'tool']);
  assert.deepEqual(gapIds(j), []);
  assert.equal(j.timeline.length, 6);
  assert.equal(j.sentence, 'Alice Example (user-alice) signed in (linked by session id only, an inference); Purchasing Agent (agent-purchasing) acted on their behalf; policy rule within-limit returned permit; the gateway allowed purchase.create (policy permit); the tool server answered 201 (success).');
  assert.deepEqual(j.delegation.chain, ['agent-purchasing']);
  assert.equal(j.delegation.text, 'user-alice -> agent-purchasing');
});

test('timeline is in time order, offsets start at zero, and links are labelled', () => {
  const { store, run } = fresh('normal-purchase');
  const j = createJoin(store.view).byTrace(run.traceId);
  const times = j.timeline.map((e) => Date.parse(e.recordedAt));
  assert.deepEqual([...times].sort((a, b) => a - b), times);
  assert.equal(j.timeline[0].offsetMs, 0);
  assert.equal(j.timeline[0].link, 'session-inferred', 'the sign-in has no trace id: it is attached by session');
  assert.ok(j.timeline.slice(2).every((e) => e.link === 'trace'));
  assert.ok(j.notes.some((n) => /inference, not proof/.test(n)));
});

test('denied scope: policy deny and gateway deny, no tool result, and that is NOT a gap', () => {
  const { store, run } = fresh('denied-scope');
  const j = createJoin(store.view).byTrace(run.traceId);
  assert.deepEqual(gapIds(j), []);
  assert.ok(!hopsPresent(j).includes('tool'));
  assert.match(j.sentence, /the gateway denied purchase\.create \(token lacks scope purchase:write\)/);
  assert.match(j.sentence, /policy rule scope-required returned deny/);
  assert.match(j.sentence, /the tool was not reached|no tool result is recorded after the denial/);
});

test('paused and approved: two humans are named, in order, and the call completes', () => {
  const { store, run } = fresh('paused-approved');
  const j = createJoin(store.view).byTrace(run.traceId);
  assert.deepEqual(gapIds(j), []);
  assert.deepEqual(hopsPresent(j), ['identity', 'token', 'gateway', 'policy', 'approval', 'tool']);
  assert.match(j.sentence, /Carla Placeholder \(user-carla\) signed in/);
  assert.match(j.sentence, /the gateway paused purchase\.create.*a human approval was requested; Dmitri Approver \(user-dmitri\) approved the call; the gateway allowed purchase\.create.*the tool server answered 201/);
});

test('killed mid-run: the kill switch (no trace id) is attached by session and labelled inferred', () => {
  const { store, run } = fresh('killed-mid-run');
  const j = createJoin(store.view).byTrace(run.traceId);
  const kill = j.timeline.find((e) => e.type === 'killswitch.kill');
  assert.ok(kill); assert.equal(kill.link, 'session-inferred'); assert.equal(kill.traceId, null);
  assert.match(j.sentence, /Olga Operator \(user-olga\) fired the kill switch for Purchasing Agent \(agent-purchasing\) \(runaway spend suspected\)/);
  assert.match(j.sentence, /the gateway denied purchase\.create \(agent-killed\); no tool result is recorded after the denial/);
  assert.deepEqual(gapIds(j), []);
  // joining from the kill event itself lands on the same transaction
  const fromKill = createJoin(store.view).byEvent(kill.id);
  assert.equal(fromKill.traceId, run.traceId); assert.equal(fromKill.focusEventId, kill.id); assert.equal(fromKill.orphan, false);
});

test('orphan: an event with no correlation id is shown as orphaned, not joined, and the sentence invents no human', () => {
  const rt = mkRuntime();
  const o = rt.seeded.find((s) => s.scenario === 'orphaned-event');
  const j = rt.join.byEvent(o.focusEventId);
  assert.equal(j.orphan, true); assert.equal(j.traceId, null); assert.equal(j.timeline.length, 1);
  assert.match(j.sentence, /no human subject is recorded/);
  assert.match(j.sentence, /agent-build-bot acted, with no human recorded/);
  assert.match(j.sentence, /retry\[U\+200B\] from build-bot/, 'the hidden character is visible');
  assert.match(j.sentence, /no correlation id/);
  for (const name of ['Alice', 'Bao', 'Carla', 'Dmitri', 'Olga', 'Purchasing', 'Booking']) assert.doesNotMatch(j.sentence, new RegExp(name), `${name} must not appear`);
  assert.ok(j.notes[0].match(/no correlation id/));
  assert.deepEqual(gapIds(j), [], 'an orphan has no analysed hops, only the orphan marker');
});

test('orphan: other events from the same agent are listed as possibly related but never joined', () => {
  const store = createStore({ now: () => NOW, key });
  const mk = (id, ms, extra = {}) => gatewayLog({ id, at: new Date(NOW.getTime() - ms), phase: 'decision', tool: 't', decision: 'allow', agentId: 'agent-z', scopes: [], latencyMs: 1, ...extra });
  const a = mk('g1', 60_000); const b = mk('g2', 30_000); const far = mk('g3', 3_600_000);
  for (const m of [far, a, b]) store.ingest(m.source, m.raw);
  const j = createJoin(store.view).byEvent('ev-000002');
  assert.equal(j.orphan, true);
  assert.deepEqual(j.possiblyRelated.map((r) => r.id), ['ev-000003']);
  assert.ok(j.possiblyRelated.every((r) => r.joined === false));
  assert.equal(j.timeline.length, 1);
});

test('two-hop delegation: the nested act claim gives the chain human -> orchestrator -> sub-agent', () => {
  const { store, run } = fresh('two-hop-delegation');
  const j = createJoin(store.view).byTrace(run.traceId);
  assert.deepEqual(j.delegation.chain, ['agent-orchestrator', 'agent-booking']);
  assert.equal(j.delegation.text, 'user-alice -> agent-orchestrator -> agent-booking');
  assert.match(j.sentence, /Booking Sub-agent \(agent-booking\) acted on their behalf through the delegation chain Alice Example \(user-alice\) -> Trip Orchestrator \(agent-orchestrator\) -> Booking Sub-agent \(agent-booking\)/);
  assert.equal(j.timeline.filter((e) => e.type === 'token.exchanged').length, 2);
  assert.deepEqual(gapIds(j), []);
});

// ---- gaps: a missing hop shows as a gap -----------------------------------------------------------------------
test('GAP: no token-exchange event', () => {
  const { join, traceId } = without('normal-purchase', (e) => e.type === 'token.exchanged');
  assert.ok(gapIds(join.byTrace(traceId)).includes('no-token-exchange'));
});
test('GAP: a missing delegation hop (one of two exchanges removed)', () => {
  const { join, traceId } = without('two-hop-delegation', (e) => e.type === 'token.exchanged' && e.delegation.length === 1);
  const j = join.byTrace(traceId);
  assert.ok(gapIds(j).includes('delegation-hop-missing'));
  assert.match(j.gaps.find((g) => g.id === 'delegation-hop-missing').message, /chain of 2 but only 1/);
});
test('GAP: allowed call with no policy decision, with no sign-in, and with no tool result', () => {
  const noPolicy = without('normal-purchase', (e) => e.type === 'policy.decision');
  assert.ok(gapIds(noPolicy.join.byTrace(noPolicy.traceId)).includes('no-policy-decision'));
  const noSignin = without('normal-purchase', (e) => e.type === 'auth.signin');
  assert.ok(gapIds(noSignin.join.byTrace(noSignin.traceId)).includes('no-signin'));
  const noResult = without('normal-purchase', (e) => e.type === 'gateway.result');
  assert.ok(gapIds(noResult.join.byTrace(noResult.traceId)).includes('allow-without-result'));
});
test('GAP: a pause with no approval event', () => {
  const j = without('paused-approved', (e) => e.type.startsWith('approval.'));
  assert.ok(gapIds(j.join.byTrace(j.traceId)).includes('pause-without-approval'));
});

test('GAP: a sign-in older than the retention window falls out of the join and shows as a gap', () => {
  const store = createStore({ now: () => NOW, key });
  const sid = 'sid-old'; const trace = { traceId: 'c'.repeat(32), spanId: 'd'.repeat(16) };
  const put = (m) => store.ingest(m.source, m.raw);
  put(idpSignin({ id: 'a', at: new Date(NOW.getTime() - 8 * DAY_MS), user: { id: 'user-q', name: 'Q Example' }, client: { id: 'c', name: 'C' }, sid }));
  put(tokenEvent({ id: 't', at: new Date(NOW.getTime() - 60_000), kind: 'token.exchanged', sub: 'user-q', clientId: 'agent-q', clientName: 'Q', aud: 'https://r.example', scope: ['s'], act: { sub: 'agent-q' }, sid, trace, jti: 'j' }));
  const j = createJoin(store.view).byTrace(trace.traceId);
  assert.ok(gapIds(j).includes('no-signin'));
  assert.ok(!j.timeline.some((e) => e.type === 'auth.signin'));
});

test('a session id alone never joins across traces: a second trace in the same session keeps its own timeline', () => {
  const rt = mkRuntime();
  const one = rt.seeded.find((s) => s.scenario === 'normal-purchase');
  const j = rt.join.byTrace(one.traceId);
  assert.ok(j.timeline.every((e) => e.traceId === one.traceId || e.link === 'session-inferred'));
  assert.ok(j.timeline.filter((e) => e.link === 'trace').every((e) => e.traceId === one.traceId));
});

test('a second trace in the same session keeps its own timeline: a session id never pulls in another trace\'s events', () => {
  const store = createStore({ now: () => NOW, key });
  const put = (m) => store.ingest(m.source, m.raw); const sid = 'sid-two';
  put(idpSignin({ id: 'a', at: new Date(NOW.getTime() - 300_000), user: { id: 'user-t', name: 'T Example' }, client: { id: 'c', name: 'C' }, sid }));
  for (const [n, ch] of [[1, 'a'], [2, 'b']]) put(gatewayLog({ id: `g${n}`, at: new Date(NOW.getTime() - n * 60_000), phase: 'decision', tool: `tool.${n}`, decision: 'allow', agentId: 'agent-t', onBehalfOf: 'user-t', scopes: [], latencyMs: 1, trace: { traceId: ch.repeat(32), spanId: 'e'.repeat(16) }, sid }));
  const j = createJoin(store.view).byTrace('a'.repeat(32));
  assert.deepEqual(j.timeline.filter((e) => e.type === 'gateway.decision').map((e) => e.tool), ['tool.1']);
  assert.ok(j.timeline.some((e) => e.type === 'auth.signin'));
});

test('AMBIGUOUS: an event whose session matches two traces is reported, not guessed', () => {
  const store = createStore({ now: () => NOW, key });
  const sid = 'sid-shared'; const put = (m) => store.ingest(m.source, m.raw);
  for (const [n, ch] of [[1, 'a'], [2, 'b']]) put(gatewayLog({ id: `g${n}`, at: new Date(NOW.getTime() - n * 60_000), phase: 'decision', tool: 't', decision: 'allow', agentId: 'agent-m', scopes: [], latencyMs: 1, trace: { traceId: ch.repeat(32), spanId: 'e'.repeat(16) }, sid }));
  put(killEvent({ id: 'k', at: new Date(NOW.getTime() - 30_000), agentId: 'agent-m', operator: { id: 'user-o', name: 'O' }, reason: 'r', sid }));
  const kill = store.all().find((e) => e.type === 'killswitch.kill');
  const j = createJoin(store.view).byEvent(kill.id);
  assert.equal(j.ambiguous, true); assert.equal(j.orphan, false); assert.equal(j.candidateTraceIds.length, 2); assert.equal(j.timeline.length, 1);
  assert.match(j.sentence, /more than one trace/);
});

test('lookups: bad and unknown keys are reported', () => {
  const { join } = mkRuntime();
  assert.equal(join.byTrace('nothex').reason, 'bad_trace_id');
  assert.equal(join.byTrace('f'.repeat(32)).reason, 'no_such_trace');
  assert.equal(join.byEvent('ev-424242').reason, 'no_such_event');
});

// ---- the sentence uses ONLY fields in the events ---------------------------------------------------------------
test('SENTENCE FROM FIELDS: names and ids that exist nowhere in the cast appear because the events carry them', () => {
  const store = createStore({ now: () => NOW, key });
  const put = (m) => store.ingest(m.source, m.raw);
  const trace = { traceId: '1'.repeat(32), spanId: '2'.repeat(16) };
  put(idpSignin({ id: 'a', at: new Date(NOW.getTime() - 5000), user: { id: 'user-zed', name: 'Zed Quux' }, client: { id: 'c', name: 'C' }, sid: 's9' }));
  put(gatewayLog({ id: 'g', at: new Date(NOW.getTime() - 4000), phase: 'decision', tool: 'widget.frob', decision: 'deny', reason: 'because reasons', agentId: 'agent-zzz', onBehalfOf: 'user-zed', scopes: [], latencyMs: 1, trace, sid: 's9' }));
  const j = createJoin(store.view).byTrace(trace.traceId);
  assert.match(j.sentence, /Zed Quux \(user-zed\) signed in/);
  assert.match(j.sentence, /agent-zzz acted on their behalf/);
  assert.match(j.sentence, /the gateway denied widget\.frob \(because reasons\)/);
});

test('SENTENCE FROM FIELDS: every fact cites events, and every id or name it prints is a value in those events', () => {
  const rt = mkRuntime();
  for (const s of rt.seeded) {
    const j = s.traceId ? rt.join.byTrace(s.traceId) : rt.join.byEvent(s.focusEventId);
    assert.equal(j.sentence, `${j.facts.map((f) => f.text).join('; ')}.`);
    const ids = new Set(j.timeline.map((e) => e.id));
    const corpus = JSON.stringify(j.timeline);
    for (const f of j.facts) {
      if (!f.negative) assert.ok(f.evidence.length > 0, `fact without evidence: ${f.text}`);
      for (const id of f.evidence) assert.ok(ids.has(id), `${f.text} cites an event outside the timeline`);
    }
    for (const token of j.sentence.match(/\b(?:user|agent)-[a-z-]+\b/g) ?? []) assert.ok(corpus.includes(token), `${token} printed but in no event (${s.scenario})`);
  }
});

test('SENTENCE FROM FIELDS: an event that carries no subject or actor yields no person in the sentence', () => {
  const d = describe([{ id: 'ev-1', type: 'gateway.result', recordedAt: NOW.toISOString(), subject: null, actor: null, delegation: [], tool: null, decision: null, status: 204, outcome: 'success' }]);
  assert.match(d.sentence, /no human subject is recorded/);
  assert.doesNotMatch(d.sentence, /acted/);
});

test('seeded scenarios: each has the expected shape in one table', () => {
  const rt = mkRuntime();
  const want = {
    'normal-purchase': { orphan: false, gaps: 0, len: 6 }, 'denied-scope': { orphan: false, gaps: 0, len: 5 }, 'paused-approved': { orphan: false, gaps: 0, len: 9 },
    'killed-mid-run': { orphan: false, gaps: 0, len: 8 }, 'orphaned-event': { orphan: true, gaps: 0, len: 1 }, 'two-hop-delegation': { orphan: false, gaps: 0, len: 7 },
  };
  for (const s of rt.seeded) {
    const j = s.traceId ? rt.join.byTrace(s.traceId) : rt.join.byEvent(s.focusEventId);
    assert.deepEqual({ orphan: j.orphan, gaps: j.gaps.length, len: j.timeline.length }, want[s.scenario], s.scenario);
  }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadEvent, delegationFromAct, normalize, toIso } from '../src/normalize.js';
import { gatewayLog, hitlEvent, idpSignin, killEvent, policyDecision, tokenEvent } from '../src/sources.js';
import { makeTraceparent, parseTraceparent } from '../src/trace.js';

const T = new Date('2026-10-21T10:00:00Z');
const trace = { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) };
const user = { id: 'user-x', name: 'X Example' };

test('each of the six raw shapes normalizes to the same envelope keys', () => {
  const made = [
    idpSignin({ id: 'a1', at: T, user, client: { id: 'c1', name: 'App' }, sid: 'sid-1' }),
    tokenEvent({ id: 't1', at: T, kind: 'token.exchanged', sub: user.id, clientId: 'agent-1', clientName: 'A1', aud: 'https://r.example', scope: ['s:w'], act: { sub: 'agent-1' }, sid: 'sid-1', trace, jti: 'j' }),
    gatewayLog({ id: 'g1', at: T, phase: 'decision', tool: 'x.y', decision: 'allow', agentId: 'agent-1', onBehalfOf: user.id, scopes: ['s:w'], trace, latencyMs: 1 }),
    policyDecision({ id: 'p1', at: T, sub: user.id, actor: 'agent-1', action: 'x.y', resource: 'https://r.example', scopes: ['s:w'], result: 'PERMIT', policy: 'p', rule: 'r', trace }),
    hitlEvent({ id: 'h1', at: T, state: 'approved', agent: 'agent-1', tool: 'x.y', onBehalfOf: user.id, approver: user, trace, sid: 'sid-1' }),
    killEvent({ id: 'k1', at: T, agentId: 'agent-1', operator: user, reason: 'r', sid: 'sid-1' }),
  ];
  const keys = made.map((m) => Object.keys(normalize(m.source, m.raw)).sort().join());
  assert.equal(new Set(keys).size, 1, 'one envelope shape');
  assert.deepEqual(made.map((m) => normalize(m.source, m.raw).type), ['auth.signin', 'token.exchanged', 'gateway.decision', 'policy.decision', 'approval.approved', 'killswitch.kill']);
  for (const m of made) assert.equal(normalize(m.source, m.raw).recordedAt, T.toISOString());
});

test('trace ids come from each source\'s own place: header, bare ids, or nowhere', () => {
  const gw = normalize(...Object.values(gatewayLog({ id: 'g', at: T, phase: 'decision', tool: 't', decision: 'allow', agentId: 'a', scopes: [], trace, latencyMs: 1 })));
  assert.equal(gw.traceId, trace.traceId); assert.equal(gw.spanId, trace.spanId); assert.match(gw.traceparent, /^00-/);
  const pol = normalize(...Object.values(policyDecision({ id: 'p', at: T, sub: 's', actor: 'a', action: 'x', resource: 'r', scopes: [], result: 'DENY', policy: 'p', rule: 'r', trace })));
  assert.equal(pol.traceId, trace.traceId);
  const idp = normalize(...Object.values(idpSignin({ id: 'a', at: T, user, client: { id: 'c', name: 'C' }, sid: 's' })));
  assert.equal(idp.traceId, null); assert.equal(idp.sessionId, 's'); assert.deepEqual(idp.flags, []);
});

test('an invalid traceparent is not trusted: no trace id, and it is flagged', () => {
  for (const header of ['00-' + '0'.repeat(32) + '-' + 'b'.repeat(16) + '-01', 'ff-' + 'a'.repeat(32) + '-' + 'b'.repeat(16) + '-01', '00-' + 'A'.repeat(32) + '-' + 'b'.repeat(16) + '-01', 'garbage', '00-' + 'a'.repeat(31) + '-' + 'b'.repeat(16) + '-01']) {
    const n = normalize('gateway', { log_id: 'g', time: T.toISOString(), phase: 'decision', tool: 't', decision: 'allow', agent_id: 'a', headers: { traceparent: header } });
    assert.equal(n.traceId, null, header);
    assert.ok(n.flags.includes('invalid-traceparent'));
    assert.ok(n.flags.includes('no-correlation-id'));
  }
  assert.equal(parseTraceparent(makeTraceparent('a'.repeat(32), 'b'.repeat(16))).traceId, 'a'.repeat(32));
  assert.equal(parseTraceparent(42), null);
});

test('an event with neither trace id nor session id is flagged no-correlation-id', () => {
  const n = normalize('gateway', { log_id: 'g', time: T.toISOString(), phase: 'decision', tool: 't', decision: 'allow', agent_id: 'a' });
  assert.deepEqual(n.flags, ['no-correlation-id']);
});

test('the nested act claim becomes a delegation list, first delegate first, current actor last', () => {
  assert.deepEqual(delegationFromAct({ sub: 'b', act: { sub: 'a' } }), ['a', 'b']);
  assert.deepEqual(delegationFromAct({ sub: 'a' }), ['a']);
  assert.deepEqual(delegationFromAct(undefined), []);
  assert.deepEqual(delegationFromAct({ sub: 5 }), []);
  const deep = (n) => (n === 0 ? { sub: 'x' } : { sub: `h${n}`, act: deep(n - 1) });
  assert.ok(delegationFromAct(deep(500)).length <= 8, 'a hostile deep act claim is bounded');
  const cyc = { sub: 'a' }; cyc.act = cyc;
  assert.ok(delegationFromAct(cyc).length <= 8, 'a cyclic act claim terminates');
});

test('hidden characters in any field are revealed, flagged, and the raw record is inert too', () => {
  const n = normalize('gateway', { log_id: 'g', time: T.toISOString(), phase: 'decision', tool: `x${String.fromCharCode(0x202E)}y`, decision: 'allow', reason: `a${String.fromCharCode(0x200B)}b`, agent_id: 'a' });
  assert.equal(n.tool, 'x[U+202E]y');
  assert.equal(n.decision.reason, 'a[U+200B]b');
  assert.ok(n.flags.includes('hidden-characters'));
  assert.equal(n.raw.reason, 'a[U+200B]b');
});

test('lengths are bounded', () => {
  const n = normalize('gateway', { log_id: 'g', time: T.toISOString(), phase: 'decision', tool: 'x'.repeat(100000), decision: 'allow', agent_id: 'a'.repeat(100000) });
  assert.ok(n.tool.length <= 201 && n.actor.length <= 201);
  assert.ok(JSON.stringify(n.raw).length < 2000);
});

test('hostile values: objects as ids, arrays, bad times and unknown sources are refused or nulled, never thrown as 500s', () => {
  const n = normalize('gateway', { log_id: { a: 1 }, time: T.toISOString(), phase: 'decision', tool: ['x'], agent_id: 7, scopes_presented: 'nope', headers: 'x' });
  assert.equal(n.sourceId, null); assert.equal(n.tool, null); assert.equal(n.actor, '7');
  assert.throws(() => normalize('gateway', { time: 'yesterday' }), BadEvent);
  assert.throws(() => normalize('gateway', { time: 1e20 }), BadEvent);
  assert.throws(() => normalize('nope', {}), BadEvent);
  assert.throws(() => normalize('gateway', null), BadEvent);
  assert.throws(() => normalize('gateway', []), BadEvent);
  assert.throws(() => normalize('__proto__', {}), BadEvent);
  assert.throws(() => toIso(undefined), BadEvent);
});

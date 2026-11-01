// Six event sources, each in its own plausible raw shape. The shapes differ on purpose: different field names,
// different time formats, different places for the trace id. Making them agree is the normalizer's job.
//
// Provenance: the identity-provider shape follows the PingOne audit activity fields the original demo read
// (id, recordedAt, action.type, actors.client/user, resources) as OBSERVED in a demo environment, UNVERIFIED against
// product documentation. The other five shapes are invented for teaching and claim to match no product.
//
// Each maker returns { source, raw }. Times are Date objects here; every source serializes them its own way.
import { makeTraceparent } from './trace.js';

const iso = (d) => d.toISOString();

export function idpSignin({ id, at, user, client, sid, resource = 'Shop Web App' }) {
  return { source: 'idp', raw: {
    id, recordedAt: iso(at),
    action: { type: 'USER.AUTHENTICATION.SUCCEEDED', description: 'User signed in' },
    actors: { user: { id: user.id, name: user.name }, client: { id: client.id, name: client.name } },
    resources: [{ type: 'APPLICATION', name: resource }],
    session: { id: sid },
    result: { status: 'SUCCESS' },
  } };
}

// kind: 'token.issued' (user token for the web app) or 'token.exchanged' (RFC 8693: the agent swaps it for a delegated one).
// act: nested { sub, act? } exactly as the token would carry it (outermost = current actor).
export function tokenEvent({ id, at, kind, sub, clientId, clientName, aud, scope, act, sid, trace, jti }) {
  return { source: 'token', raw: {
    event_id: id, ts_ms: at.getTime(), kind,
    grant_type: kind === 'token.exchanged' ? 'urn:ietf:params:oauth:grant-type:token-exchange' : 'authorization_code',
    sub, client_id: clientId, client_name: clientName, aud, scope: scope.join(' '),
    ...(act ? { act } : {}),
    jti,
    ...(sid ? { sid } : {}),
    ...(trace ? { traceparent: makeTraceparent(trace.traceId, trace.spanId) } : {}),
    mock_token_label: 'MOCK-ISSUED claims, not a real credential',
  } };
}

// phase 'decision': the gateway's allow/deny/pause. phase 'upstream': what the tool server answered.
export function gatewayLog({ id, at, phase, tool, decision, reason, rule, agentId, onBehalfOf, scopes, status, trace, sid, latencyMs, route = '/mcp/shop' }) {
  return { source: 'gateway', raw: {
    log_id: id, time: iso(at), phase, route, tool,
    ...(decision ? { decision } : {}),
    ...(reason ? { reason } : {}),
    ...(rule ? { rule } : {}),
    agent_id: agentId,
    ...(onBehalfOf ? { on_behalf_of: onBehalfOf } : {}),
    scopes_presented: scopes,
    ...(status !== undefined ? { status } : {}),
    ...(sid ? { sid } : {}),
    latency_ms: latencyMs,
    headers: trace ? { traceparent: makeTraceparent(trace.traceId, trace.spanId) } : {},
  } };
}

export function policyDecision({ id, at, sub, actor, action, resource, scopes, result, policy, rule, obligations, trace, sid }) {
  return { source: 'policy', raw: {
    decisionId: id, evaluatedAt: iso(at),
    request: { subject: { sub }, actor: { id: actor }, action, resource, context: { scopes } },
    result, policy, rule,
    ...(obligations ? { obligations } : {}),
    trace: { trace_id: trace.traceId, span_id: trace.spanId },
    ...(sid ? { sid } : {}),
  } };
}

export function hitlEvent({ id, at, state, agent, tool, onBehalfOf, approver, comment, trace, sid }) {
  return { source: 'hitl', raw: {
    approval_id: id, at: iso(at), state,
    request: { agent, tool, on_behalf_of: onBehalfOf },
    ...(approver ? { approver: { id: approver.id, name: approver.name } } : {}),
    ...(comment ? { comment } : {}),
    trace_id: trace.traceId, span_id: trace.spanId,
    sid,
  } };
}

// The kill switch knows the run (session) it stopped, not the trace: it is a control-plane event.
export function killEvent({ id, at, agentId, operator, reason, sid }) {
  return { source: 'killswitch', raw: {
    seq: id, occurred: iso(at), command: 'kill',
    target: { type: 'agent', id: agentId },
    issued_by: { id: operator.id, name: operator.name },
    reason,
    run: { sid },
  } };
}

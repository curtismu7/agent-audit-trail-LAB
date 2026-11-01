// The normalizer: six raw shapes in, one common envelope out. Pure; no I/O.
//
// Envelope (every field is present; absent facts are null, never guessed):
//   id            assigned by the store ('ev-000042'); null until stored
//   source        idp | token | gateway | policy | hitl | killswitch
//   sourceId      the id the source gave the event
//   type          auth.signin | token.issued | token.exchanged | gateway.decision | gateway.result
//                 | policy.decision | approval.requested | approval.approved | approval.denied | approval.expired | killswitch.kill
//   sourceType    the source's own label for it
//   recordedAt    ISO-8601 UTC, millisecond precision
//   traceId, spanId, traceparent   W3C Trace Context; null when the source carried none or carried an invalid one
//   sessionId     the sign-in session / agent run id when the source carried one
//   subject, subjectName           the human the action is for (sub), name only if the source itself gave one
//   actor, actorName               the agent that acted
//   delegation    actors from the first delegate to the current actor, from a nested `act` claim; [] when none
//   tool, resource, scopes
//   decision      { result, rule, reason } | null
//   outcome       'success' | 'failure' | 'killed' | null
//   flags         hidden-characters | invalid-traceparent | invalid-trace-id | no-correlation-id | delegation-cycle | delegation-truncated
//   raw           the source's own record, made inert
// Every string is made inert (hidden characters shown as [U+XXXX]) and bounded before it is stored.
import { inertValue, hasUnsafe, revealText } from './sanitize.js';
import { parseTraceparent, validSpanId, validTraceId } from './trace.js';

export const SOURCES = ['idp', 'token', 'gateway', 'policy', 'hitl', 'killswitch'];

export class BadEvent extends Error {
  constructor(message) { super(message); this.name = 'BadEvent'; this.code = 'bad_event'; }
}

// Plausible event times only (2000-01-01 to 2100-01-01): a far-future stamp would sit inside every retention window.
export const MIN_MS = Date.UTC(2000, 0, 1);
export const MAX_MS = Date.UTC(2100, 0, 1);
export function toIso(v) {
  let ms = NaN;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(v)) ms = Date.parse(v);
  else if (typeof v === 'number' && Number.isFinite(v)) ms = v;
  if (!Number.isFinite(ms)) throw new BadEvent('event has no usable timestamp');
  const d = new Date(ms);
  if (Number.isNaN(d.getTime()) || ms < MIN_MS || ms > MAX_MS) throw new BadEvent('event timestamp out of range');
  return d.toISOString();
}

const obj = (v) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v : {});

// A string field: strings and finite numbers only, made inert, bounded.
function makeText(flagSink) {
  return (v, max = 200) => {
    if (typeof v === 'number' && Number.isFinite(v)) v = String(v);
    if (typeof v !== 'string' || v === '') return null;
    if (hasUnsafe(v)) flagSink.add('hidden-characters');
    return revealText(v, max);
  };
}

// Nested act claim -> actors from first delegate to current actor (RFC 8693: the outermost act is the current actor).
// A repeated actor (a cycle) or a chain deeper than MAX_HOPS is never passed off as a complete chain: the walk stops
// and actProblem() says which it was, so the normalizer flags the event and the join shows a gap.
export const MAX_HOPS = 8;
function walkAct(act) {
  const out = [];
  let problem = null;
  let cur = act;
  while (cur && typeof cur === 'object' && typeof cur.sub === 'string') {
    if (out.includes(cur.sub)) { problem = 'delegation-cycle'; break; }
    if (out.length >= MAX_HOPS) { problem = 'delegation-truncated'; break; }
    out.push(cur.sub);
    cur = cur.act;
  }
  return { chain: out.reverse(), problem };
}
export const delegationFromAct = (act) => walkAct(act).chain;
export const actProblem = (act) => walkAct(act).problem;

function traceFields(flags, { header, traceId, spanId }) {
  if (header !== undefined) {
    const p = parseTraceparent(header);
    if (!p) { flags.add('invalid-traceparent'); return { traceId: null, spanId: null, traceparent: null }; }
    return { traceId: p.traceId, spanId: p.spanId, traceparent: header };
  }
  if (traceId !== undefined) {
    if (!validTraceId(traceId)) { flags.add('invalid-trace-id'); return { traceId: null, spanId: null, traceparent: null }; }
    return { traceId, spanId: validSpanId(spanId) ? spanId : null, traceparent: null };
  }
  return { traceId: null, spanId: null, traceparent: null };
}

// Lower-case the RAW value before it is revealed, so a hidden character shows as the documented [U+XXXX] (upper-case hex).
const decisionOf = (t, result, rule, reason) => {
  const r = t(typeof result === 'string' ? result.toLowerCase() : result, 40);
  return r ? { result: r, rule: t(rule), reason: t(reason, 300) } : null;
};

const NORMALIZERS = {
  idp(raw, t, flags) {
    const user = obj(obj(raw.actors).user); const client = obj(obj(raw.actors).client);
    const ok = obj(raw.result).status === 'SUCCESS';
    return {
      sourceId: t(raw.id), sourceTime: raw.recordedAt, type: 'auth.signin', sourceType: t(obj(raw.action).type),
      ...traceFields(flags, {}), sessionId: t(obj(raw.session).id),
      subject: t(user.id), subjectName: t(user.name), actor: null, actorName: null, clientId: t(client.id), clientName: t(client.name),
      delegation: [], tool: null, resource: t(obj(Array.isArray(raw.resources) ? raw.resources[0] : null).name),
      scopes: [], decision: null, outcome: ok ? 'success' : 'failure',
      summary: t(obj(raw.action).description, 300),
    };
  },
  token(raw, t, flags) {
    const exchanged = raw.kind === 'token.exchanged';
    const { chain, problem } = walkAct(raw.act);
    if (problem) flags.add(problem);
    const scopes = typeof raw.scope === 'string' ? raw.scope.split(' ').filter(Boolean).slice(0, 30).map((s) => t(s, 80)).filter(Boolean) : [];
    return {
      sourceId: t(raw.event_id), sourceTime: raw.ts_ms, type: exchanged ? 'token.exchanged' : 'token.issued', sourceType: t(raw.kind),
      ...traceFields(flags, { header: raw.traceparent }), sessionId: t(raw.sid),
      subject: t(raw.sub), subjectName: null,
      actor: exchanged ? (chain.length ? t(chain[chain.length - 1]) : null) : null, actorName: null,
      clientId: t(raw.client_id), clientName: t(raw.client_name),
      delegation: chain.map((c) => t(c)).filter(Boolean), tool: null, resource: t(raw.aud), scopes,
      decision: null, outcome: 'success',
      summary: `${exchanged ? 'token exchange' : 'token issued'} for audience ${t(raw.aud) ?? 'unknown'}`,
    };
  },
  gateway(raw, t, flags) {
    const upstream = raw.phase === 'upstream';
    const status = Number.isInteger(raw.status) ? raw.status : null;
    return {
      sourceId: t(raw.log_id), sourceTime: raw.time, type: upstream ? 'gateway.result' : 'gateway.decision', sourceType: t(`gateway.${raw.phase ?? 'log'}`),
      ...traceFields(flags, { header: obj(raw.headers).traceparent }), sessionId: t(raw.sid),
      subject: t(raw.on_behalf_of), subjectName: null, actor: t(raw.agent_id), actorName: null,
      delegation: [], tool: t(raw.tool), resource: t(raw.route), scopes: Array.isArray(raw.scopes_presented) ? raw.scopes_presented.slice(0, 30).map((s) => t(s, 80)).filter(Boolean) : [],
      decision: upstream ? null : decisionOf(t, raw.decision, raw.rule, raw.reason),
      outcome: upstream ? (status !== null && status < 400 ? 'success' : 'failure') : null,
      status,
      summary: upstream ? `tool server answered ${status ?? 'no status'}` : `gateway ${t(raw.decision, 40) ?? 'decision'} for ${t(raw.tool) ?? 'unknown tool'}`,
    };
  },
  policy(raw, t, flags) {
    const req = obj(raw.request);
    return {
      sourceId: t(raw.decisionId), sourceTime: raw.evaluatedAt, type: 'policy.decision', sourceType: t(raw.policy),
      ...traceFields(flags, { traceId: obj(raw.trace).trace_id, spanId: obj(raw.trace).span_id }), sessionId: t(raw.sid),
      subject: t(obj(req.subject).sub), subjectName: null, actor: t(obj(req.actor).id), actorName: null,
      delegation: [], tool: t(req.action), resource: t(req.resource), scopes: Array.isArray(obj(req.context).scopes) ? obj(req.context).scopes.slice(0, 30).map((s) => t(s, 80)).filter(Boolean) : [],
      decision: decisionOf(t, raw.result, raw.rule, Array.isArray(raw.obligations) ? `obligations: ${raw.obligations.slice(0, 5).map((o) => t(o, 60)).join(', ')}` : null),
      outcome: null,
      summary: `policy ${t(raw.result, 40) ?? 'decision'} by ${t(raw.rule) ?? 'unknown rule'}`,
    };
  },
  hitl(raw, t, flags) {
    const state = t(raw.state, 20);
    const req = obj(raw.request); const ap = obj(raw.approver);
    return {
      sourceId: t(raw.approval_id), sourceTime: raw.at, type: `approval.${['requested', 'approved', 'denied', 'expired'].includes(state) ? state : 'requested'}`, sourceType: state ? `hitl.${state}` : null,
      ...traceFields(flags, { traceId: raw.trace_id, spanId: raw.span_id }), sessionId: t(raw.sid),
      subject: t(req.on_behalf_of), subjectName: null, actor: t(req.agent), actorName: null,
      approverId: t(ap.id), approverName: t(ap.name),
      delegation: [], tool: t(req.tool), resource: null, scopes: [],
      decision: state && state !== 'requested' ? decisionOf(t, state, null, raw.comment) : null, outcome: null,
      summary: `approval ${state ?? 'event'}`,
    };
  },
  killswitch(raw, t, flags) {
    const by = obj(raw.issued_by);
    return {
      sourceId: t(raw.seq), sourceTime: raw.occurred, type: 'killswitch.kill', sourceType: t(raw.command),
      ...traceFields(flags, {}), sessionId: t(obj(raw.run).sid),
      subject: null, subjectName: null, actor: t(obj(raw.target).id), actorName: null,
      operatorId: t(by.id), operatorName: t(by.name),
      delegation: [], tool: null, resource: null, scopes: [],
      decision: decisionOf(t, 'killed', null, raw.reason), outcome: 'killed',
      summary: `kill switch fired for ${t(obj(raw.target).id) ?? 'unknown target'}`,
    };
  },
};

export function normalize(source, raw) {
  if (!Object.hasOwn(NORMALIZERS, source)) throw new BadEvent(`unknown event source: ${revealText(source, 40)}`);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new BadEvent('event is not an object');
  const flags = new Set();
  const t = makeText(flags);
  const n = NORMALIZERS[source](raw, t, flags);
  const seen = { hidden: false };
  const inertRaw = inertValue(raw, seen);
  if (seen.hidden) flags.add('hidden-characters');
  const recordedAt = toIso(n.sourceTime);
  delete n.sourceTime;
  const env = {
    id: null, source, recordedAt,
    approverId: null, approverName: null, operatorId: null, operatorName: null, clientId: null, clientName: null, status: null,
    ...n,
  };
  if (!env.traceId && !env.sessionId) flags.add('no-correlation-id');
  return { ...env, flags: [...flags].sort(), raw: inertRaw };
}

// The hop an event type belongs to, for gap detection and display.
export const HOP_OF = {
  'auth.signin': 'identity', 'token.issued': 'token', 'token.exchanged': 'token',
  'gateway.decision': 'gateway', 'policy.decision': 'policy',
  'approval.requested': 'approval', 'approval.approved': 'approval', 'approval.denied': 'approval', 'approval.expired': 'approval',
  'gateway.result': 'tool', 'killswitch.kill': 'killswitch',
};
export const HOP_ORDER = ['identity', 'token', 'gateway', 'policy', 'approval', 'tool', 'killswitch'];

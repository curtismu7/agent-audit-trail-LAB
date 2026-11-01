// The correlation JOIN: stitch events from different sources into one per-action timeline.
//
// Correlation keys, strongest first:
//   traceId    (W3C trace id)  events sharing it are the same transaction. link = 'trace'
//   sessionId  (sign-in session / agent run)  a session holds many traces, so it only attaches events that carry NO
//              trace id (the human's sign-in, the kill switch), and only inside a time window around the trace.
//              link = 'session-inferred', shown as inferred, never as fact about the transaction.
//   actor / tool ids are never used to join. For an orphaned event they are used only to LIST possibly related
//   events, which are not joined.
//
// The plain-English sentence is built ONLY from fields in the events. Every clause is a "fact" that names the events
// it came from; a value is printed only if some event in the timeline carries it. Nothing is looked up elsewhere.
import { HOP_OF, HOP_ORDER, MAX_HOPS } from './normalize.js';
import { validTraceId } from './trace.js';

export const SESSION_BEFORE_MS = 60 * 60_000; // a sign-in may precede the trace by up to an hour
export const SESSION_AFTER_MS = 10 * 60_000;
export const RELATED_WINDOW_MS = 120_000;
const ms = (e) => Date.parse(e.recordedAt);

const PUBLIC = ['id', 'source', 'type', 'sourceType', 'recordedAt', 'traceId', 'spanId', 'sessionId', 'subject', 'subjectName', 'actor', 'actorName', 'delegation', 'tool', 'resource', 'scopes', 'decision', 'outcome', 'status', 'summary', 'flags', 'approverId', 'approverName', 'operatorId', 'operatorName', 'clientId', 'clientName'];

function names(events) {
  const m = new Map();
  for (const e of events) {
    for (const [id, name] of [[e.subject, e.subjectName], [e.clientId, e.clientName], [e.approverId, e.approverName], [e.operatorId, e.operatorName], [e.actor, e.actorName]]) if (id && name && !m.has(id)) m.set(id, name);
  }
  return (id) => (m.has(id) ? `${m.get(id)} (${id})` : id);
}

const VERB = { allow: 'allowed', deny: 'denied', pause: 'paused' };

export const MAX_FACTS = 40;
const INFERRED = ' (linked by session id only, an inference)';

// `inferredIds`: ids of events attached by session id alone. A fact that rests only on such an event says so.
export function describe(timeline, inferredIds = new Set()) {
  const label = names(timeline);
  const facts = [];
  const add = (text, evidence, negative = false) => facts.push({ text, evidence: evidence.map((e) => e.id), ...(negative ? { negative: true } : {}) });
  const of = (type) => timeline.filter((e) => e.type === type);
  const signin = of('auth.signin')[0];
  const withSubject = timeline.find((e) => e.subject);
  const subject = signin?.subject ?? withSubject?.subject ?? null;
  const gwDecisions = of('gateway.decision');
  const exchanges = of('token.exchanged');
  const longest = exchanges.reduce((best, e) => (e.delegation.length > (best?.delegation.length ?? 0) ? e : best), null);
  const actor = gwDecisions.at(-1)?.actor ?? exchanges.at(-1)?.actor ?? timeline.find((e) => e.actor)?.actor ?? null;
  const chain = longest ? longest.delegation : (actor ? [actor] : []);

  if (subject) {
    const basis = signin ?? withSubject;
    const q = inferredIds.has(basis.id) ? INFERRED : '';
    add(signin ? `${label(subject)} signed in${q}` : `${label(subject)} is the human subject${q}`, [basis]);
  }
  else add('no human subject is recorded in these events', [], true);

  if (actor && subject) {
    const via = timeline.filter((e) => e.actor === actor || e.delegation.includes(actor));
    add(chain.length > 1
      ? `${label(actor)} acted on their behalf through the delegation chain ${[subject, ...chain].map(label).join(' -> ')}`
      : `${label(actor)} acted on their behalf`, longest ? [longest] : via.slice(0, 1));
  } else if (actor) {
    add(`${label(actor)} acted, with no human recorded`, timeline.filter((e) => e.actor === actor).slice(0, 1));
  }

  // The rest in time order, one clause per event, each naming its evidence.
  let clauses = 0;
  for (const e of timeline) {
    if (facts.length >= MAX_FACTS) { clauses += 1; continue; }
    if (e.type === 'gateway.decision') {
      const r = e.decision?.result;
      add(`the gateway ${VERB[r] ?? r ?? 'logged'} ${e.tool ?? 'a call'}${e.decision?.reason ? ` (${e.decision.reason})` : ''}`, [e]);
    } else if (e.type === 'policy.decision') {
      add(`policy rule ${e.decision?.rule ?? 'unnamed'} returned ${e.decision?.result ?? 'no result'}`, [e]);
    } else if (e.type.startsWith('approval.')) {
      const who = e.approverId ? label(e.approverId) : null;
      add(e.type === 'approval.requested' ? 'a human approval was requested' : `${who ?? 'an approver'} ${e.type.slice(9)} the call`, [e]);
    } else if (e.type === 'killswitch.kill') {
      add(`${e.operatorId ? label(e.operatorId) : 'an operator'} fired the kill switch for ${e.actor ? label(e.actor) : 'an agent'}${e.decision?.reason ? ` (${e.decision.reason})` : ''}`, [e]);
    } else if (e.type === 'gateway.result') {
      add(`the tool server answered ${e.status ?? 'without a status'}${e.outcome === 'success' ? ' (success)' : ' (failure)'}`, [e]);
    }
  }
  if (clauses) add(`${clauses} further event(s) in this timeline are not described here`, [], true);
  const lastGw = gwDecisions.at(-1);
  if (lastGw?.decision?.result === 'deny' && !of('gateway.result').some((r) => ms(r) > ms(lastGw))) add('no tool result is recorded after the denial', [lastGw]);

  return { sentence: `${facts.map((f) => f.text).join('; ')}.`, facts, subject, actor, chain };
}

export function findGaps(timeline) {
  const gaps = [];
  const of = (type) => timeline.filter((e) => e.type === type);
  const gap = (hop, id, message) => gaps.push({ hop, id, message });
  const hasSubject = timeline.some((e) => e.subject);
  if (hasSubject && !of('auth.signin').length) gap('identity', 'no-signin', 'No sign-in event for this human\'s session was found in the retained window.');
  if (timeline.some((e) => e.actor) && !of('token.exchanged').length) gap('token', 'no-token-exchange', 'An agent acted but no token-exchange event is on record, so the record does not show how it got its authority.');
  for (const e of timeline) {
    for (const f of ['delegation-cycle', 'delegation-truncated']) {
      if (e.flags.includes(f)) gap('token', f, f === 'delegation-cycle'
        ? `The act claim on ${e.id} repeats an actor (a cycle), so its delegation chain is not trustworthy and is shown only up to the first repeat.`
        : `The act claim on ${e.id} is deeper than the ${MAX_HOPS} hops this app reads; the oldest hops are not shown, so the chain is incomplete.`);
    }
  }
  const depth = Math.max(0, ...of('token.exchanged').map((e) => e.delegation.length));
  if (of('token.exchanged').length < depth) gap('token', 'delegation-hop-missing', `The token carries a delegation chain of ${depth} but only ${of('token.exchanged').length} token-exchange event(s) are on record: a hop is missing.`);
  const gw = of('gateway.decision');
  if (gw.some((g) => ['allow', 'pause'].includes(g.decision?.result)) && !of('policy.decision').length) gap('policy', 'no-policy-decision', 'The gateway allowed or paused a call but no policy decision is on record.');
  if (gw.some((g) => g.decision?.result === 'pause') && !timeline.some((e) => e.type.startsWith('approval.'))) gap('approval', 'pause-without-approval', 'The gateway paused a call but no approval event is on record.');
  const allows = gw.filter((g) => g.decision?.result === 'allow').length;
  if (allows > of('gateway.result').length) gap('tool', 'allow-without-result', `The gateway allowed ${allows} call(s) but only ${of('gateway.result').length} tool result(s) are on record.`);
  return gaps;
}

const pub = (e, link, t0) => ({ ...Object.fromEntries(PUBLIC.map((k) => [k, e[k]])), hop: HOP_OF[e.type] ?? 'unknown', link, offsetMs: ms(e) - t0 });

export function createJoin(view) {
  const events = () => view.windowEvents();

  function assemble(all, core, { traceId, focusEventId = null, notes = [] }) {
    const start = Math.min(...core.map(ms)); const end = Math.max(...core.map(ms));
    const sids = new Set(core.map((e) => e.sessionId).filter(Boolean));
    const coreIds = new Set(core.map((e) => e.id));
    const weak = all.filter((e) => !coreIds.has(e.id) && !e.traceId && e.sessionId && sids.has(e.sessionId) && ms(e) >= start - SESSION_BEFORE_MS && ms(e) <= end + SESSION_AFTER_MS);
    const order = (a, b) => ms(a) - ms(b) || HOP_ORDER.indexOf(HOP_OF[a.type]) - HOP_ORDER.indexOf(HOP_OF[b.type]) || a.id.localeCompare(b.id);
    const merged = [...core.map((e) => ({ e, link: 'trace' })), ...weak.map((e) => ({ e, link: 'session-inferred' }))].sort((a, b) => order(a.e, b.e));
    const timeline = merged.map((m) => m.e);
    const t0 = ms(timeline[0]);
    const inferredIds = new Set(weak.map((e) => e.id));
    const d = describe(timeline, inferredIds);
    const gaps = findGaps(timeline);
    const hops = HOP_ORDER.map((hop) => {
      const ids = timeline.filter((e) => HOP_OF[e.type] === hop).map((e) => e.id);
      return { hop, present: ids.length > 0, eventIds: ids, inferredOnly: ids.length > 0 && ids.every((id) => inferredIds.has(id)) };
    });
    if (weak.length) notes.push('Events marked session-inferred carry no trace id; they are attached because they share the session id and fall inside the time window. That link is an inference, not proof.');
    return {
      found: true, traceId, focusEventId, orphan: false, ambiguous: false,
      timeline: merged.map((m) => pub(m.e, m.link, t0)), hops, gaps,
      delegation: { subject: d.subject, chain: d.chain, text: d.chain.length ? [d.subject, ...d.chain].filter(Boolean).join(' -> ') : null },
      sentence: d.sentence, facts: d.facts, notes, possiblyRelated: [],
    };
  }

  function alone(all, e, { ambiguous = false, candidateTraceIds = [] } = {}) {
    const d = describe([e]);
    const related = all.filter((o) => o.id !== e.id && e.actor && o.actor === e.actor && Math.abs(ms(o) - ms(e)) <= RELATED_WINDOW_MS).map((o) => o.id).slice(0, 20);
    const notes = ambiguous
      ? [`This event carries a session id that matches ${candidateTraceIds.length} traces; it is not joined to any of them.`]
      : [e.sessionId ? 'This event carries a session id but no trace in the retained window matches it; it cannot be tied to a transaction.' : 'This event carries no correlation id (no trace id, no session id): it cannot be tied to a human or a transaction. It is shown as orphaned and nothing is guessed.'];
    const extra = { text: ambiguous ? 'its session matches more than one trace, so it is not joined' : 'it has no correlation id, so it is not joined to a human or a transaction', evidence: [e.id], negative: true };
    return {
      found: true, traceId: e.traceId, focusEventId: e.id, orphan: !ambiguous, ambiguous, candidateTraceIds,
      timeline: [pub(e, 'seed', ms(e))], hops: HOP_ORDER.map((hop) => ({ hop, present: HOP_OF[e.type] === hop, eventIds: HOP_OF[e.type] === hop ? [e.id] : [], inferredOnly: false })),
      gaps: [], delegation: { subject: d.subject, chain: d.chain, text: d.chain.length ? [d.subject, ...d.chain].filter(Boolean).join(' -> ') : null },
      sentence: `${d.sentence.slice(0, -1)}; ${extra.text}.`, facts: [...d.facts, extra], notes, possiblyRelated: related.map((id) => ({ id, joined: false, why: 'same agent id within 2 minutes; no shared correlation id' })),
    };
  }

  function byTrace(traceId, focusEventId = null) {
    if (!validTraceId(traceId)) return { found: false, reason: 'bad_trace_id' };
    const all = events();
    const core = all.filter((e) => e.traceId === traceId);
    if (!core.length) return { found: false, reason: 'no_such_trace' };
    return assemble(all, core, { traceId, focusEventId });
  }

  function byEvent(eventId) {
    const all = events();
    const e = all.find((x) => x.id === eventId);
    if (!e) return { found: false, reason: 'no_such_event' };
    if (e.traceId) return assemble(all, all.filter((x) => x.traceId === e.traceId), { traceId: e.traceId, focusEventId: e.id });
    if (e.sessionId) {
      const byTraceId = new Map();
      for (const x of all) if (x.traceId && x.sessionId === e.sessionId) { const r = byTraceId.get(x.traceId) ?? { lo: Infinity, hi: -Infinity }; r.lo = Math.min(r.lo, ms(x)); r.hi = Math.max(r.hi, ms(x)); byTraceId.set(x.traceId, r); }
      const candidates = [...byTraceId].filter(([, r]) => ms(e) >= r.lo - SESSION_BEFORE_MS && ms(e) <= r.hi + SESSION_AFTER_MS).map(([t]) => t).sort();
      if (candidates.length === 1) return assemble(all, all.filter((x) => x.traceId === candidates[0]), { traceId: candidates[0], focusEventId: e.id });
      if (candidates.length > 1) return alone(all, e, { ambiguous: true, candidateTraceIds: candidates });
    }
    return alone(all, e);
  }

  return { byTrace, byEvent };
}

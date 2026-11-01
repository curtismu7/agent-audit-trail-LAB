// The audit store: normalized events in a hash chain, a retention window, and the three read operations the tools use.
//
// RETENTION. The original demo observed that the PingOne audit activities endpoint answered a 30-day window with ZERO
// events while a 7-day window returned hundreds: asking past retention is not an error, it silently comes back empty,
// which reads as "nothing happened". That is as observed in a demo environment and UNVERIFIED against product
// documentation; this app makes no claim about real retention. The mock reproduces the behaviour so it can be taught:
//   upstreamQuery(days)  the mock upstream: days > retention -> [] with no error (the trap)
//   search / summary     the audit tool layer: clamp days to retention and SAY SO in the result
import { CHAIN_CAP, createChain } from './chain.js';
import { BadEvent, normalize } from './normalize.js';

export const RETENTION_DAYS = 7;
export const DAY_MS = 86_400_000;
export const MAX_LIMIT = 200;
export const DEFAULT_LIMIT = 50;
export const UNVERIFIED = 'As observed in the demo environment, UNVERIFIED against product documentation. This app makes no claim about real retention, field names or latency.';

const pad = (n) => String(n).padStart(6, '0');
export const EVENT_ID_RE = /^ev-\d{6}$/;
export const CURSOR_RE = /^c1\.\d{1,15}\.\d{1,9}$/;

export function createStore({ now = () => new Date(), key, cap = CHAIN_CAP, retentionDays = RETENTION_DAYS } = {}) {
  const chain = createChain({ key, now, cap });
  let rejected = 0;

  function ingest(source, raw) {
    let env;
    try { env = normalize(source, raw); } catch (e) { if (e instanceof BadEvent) { rejected += 1; } throw e; }
    env.id = `ev-${pad(chain.head.seq + 1)}`;
    return chain.append(env).event;
  }

  const all = () => chain.list().map((e) => e.event);
  const sinceMs = (days) => now().getTime() - days * DAY_MS;
  const inWindow = (days) => { const s = sinceMs(days); return all().filter((e) => Date.parse(e.recordedAt) > s); };

  // The mock upstream, trap included: a window past retention returns nothing and raises nothing.
  function upstreamQuery(days) {
    if (days > retentionDays) return [];
    return inWindow(days);
  }

  // Clamp a requested window to retention. Returns the days actually used and a note when it was clamped.
  function clampDays(requested) {
    if (requested === undefined || requested === null) return { days: retentionDays, requested: retentionDays, clamped: false, note: null };
    if (requested > retentionDays) {
      return { days: retentionDays, requested, clamped: true, note: `clamped to ${retentionDays} days (requested ${requested}). Events older than ${retentionDays} days are not queryable here; an empty answer past that would mean "outside retention", not "nothing happened". ${UNVERIFIED}` };
    }
    return { days: requested, requested, clamped: false, note: null };
  }

  const slim = (e) => ({
    id: e.id, recordedAt: e.recordedAt, source: e.source, type: e.type, sourceType: e.sourceType,
    traceId: e.traceId, sessionId: e.sessionId, subject: e.subject, actor: e.actor, tool: e.tool,
    decision: e.decision ? e.decision.result : null, summary: e.summary, flags: e.flags,
  });

  const order = (a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt) || seqOf(b) - seqOf(a);
  const seqOf = (e) => Number(e.id.slice(3));

  // Filters: all optional, AND-ed. Strings compare exactly.
  function matches(e, f) {
    if (f.eventType !== undefined && e.type !== f.eventType && e.sourceType !== f.eventType) return false;
    if (f.source !== undefined && e.source !== f.source) return false;
    if (f.traceId !== undefined && e.traceId !== f.traceId) return false;
    if (f.sessionId !== undefined && e.sessionId !== f.sessionId) return false;
    if (f.actor !== undefined && e.actor !== f.actor) return false;
    if (f.subject !== undefined && e.subject !== f.subject) return false;
    if (f.tool !== undefined && e.tool !== f.tool) return false;
    if (f.decision !== undefined && (e.decision ? e.decision.result : null) !== f.decision) return false;
    if (f.orphaned !== undefined && (e.traceId === null) !== f.orphaned) return false;
    return true;
  }

  function search({ days, limit, cursor, ...filters } = {}) {
    const w = clampDays(days);
    const wanted = limit === undefined ? DEFAULT_LIMIT : limit;
    const used = Math.min(Math.max(wanted, 1), MAX_LIMIT);
    const limitNote = wanted > MAX_LIMIT ? `limit clamped to ${MAX_LIMIT} (requested ${wanted}); follow nextCursor for more` : null;
    let rows = inWindow(w.days).filter((e) => matches(e, filters)).sort(order);
    const total = rows.length;
    if (cursor !== undefined) {
      const [, ms, seq] = cursor.split('.');
      rows = rows.filter((e) => Date.parse(e.recordedAt) < Number(ms) || (Date.parse(e.recordedAt) === Number(ms) && seqOf(e) < Number(seq)));
    }
    const page = rows.slice(0, used);
    const last = page[page.length - 1];
    return {
      windowDays: w.days, requestedDays: w.requested, clamped: w.clamped, since: new Date(sinceMs(w.days)).toISOString(),
      note: [w.note, limitNote].filter(Boolean).join(' ') || null,
      total, count: page.length, limit: used,
      nextCursor: rows.length > used && last ? `c1.${Date.parse(last.recordedAt)}.${seqOf(last)}` : null,
      events: page.map(slim),
    };
  }

  // The full envelope (with the inert raw record). An event outside the retention window is "not found": the
  // upstream cannot see it either.
  function get(id) {
    const e = all().find((x) => x.id === id);
    if (!e || Date.parse(e.recordedAt) <= sinceMs(retentionDays)) return null;
    return structuredClone(e);
  }

  function summary({ days } = {}) {
    const w = clampDays(days);
    const rows = inWindow(w.days);
    const count = (fn) => Object.fromEntries(Object.entries(rows.reduce((o, e) => { const k = fn(e) ?? '(none)'; o[k] = (o[k] || 0) + 1; return o; }, {})).sort((a, b) => b[1] - a[1]));
    return {
      windowDays: w.days, requestedDays: w.requested, clamped: w.clamped, since: new Date(sinceMs(w.days)).toISOString(), note: w.note,
      total: rows.length,
      byType: count((e) => e.type), bySource: count((e) => e.source), byActor: count((e) => e.actor), byDecision: count((e) => (e.decision ? e.decision.result : null)),
      traces: new Set(rows.map((e) => e.traceId).filter(Boolean)).size,
      orphaned: rows.filter((e) => e.traceId === null).length,
    };
  }

  // What the retention demo shows: the same question asked of the raw upstream and of the audit tool.
  function retentionDemo(requestedDays) {
    const raw = upstreamQuery(requestedDays);
    const tool = search({ days: requestedDays, limit: 1 });
    const beyond = all().filter((e) => Date.parse(e.recordedAt) <= sinceMs(retentionDays)).length;
    return {
      requestedDays, retentionDays, provenance: UNVERIFIED,
      naiveUpstream: { windowDays: requestedDays, count: raw.length, error: null, note: requestedDays > retentionDays ? 'silently empty: no error, no warning. "Zero events" here means "asked past retention", not "nothing happened".' : 'within retention: answers normally' },
      auditTool: { windowDays: tool.windowDays, count: tool.total, clamped: tool.clamped, note: tool.note ?? 'within retention: answers normally' },
      storedBeyondRetention: beyond,
    };
  }

  // The read-only view handed to the tools. It has no append, no chain, no reset: the audit surface exposes exactly
  // what is implemented.
  const view = Object.freeze({ search, get, summary, windowEvents: () => inWindow(retentionDays).map((e) => structuredClone(e)), retentionDays });

  return {
    ingest, view, search, get, summary, upstreamQuery, retentionDemo, clampDays, chain,
    all: () => all().map((e) => structuredClone(e)),
    get size() { return chain.size; }, get rejected() { return rejected; }, retentionDays,
  };
}

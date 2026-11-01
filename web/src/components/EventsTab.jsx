import React, { useCallback, useEffect, useRef, useState } from "react";
import { getSummary, searchEvents } from "../lib/api.js";
import { clock } from "../lib/format.js";
import { Decision, UnverifiedBadge } from "./Badges.jsx";
import { Untrusted } from "./Untrusted.jsx";

const SOURCES = ["idp", "token", "gateway", "policy", "hitl", "killswitch"];
const EMPTY = { source: "", eventType: "", actor: "", subject: "", tool: "", decision: "", traceId: "", sessionId: "", orphaned: "", days: "7", limit: "10" };
const TEXT_FIELDS = [["eventType", "Event type"], ["actor", "Agent id"], ["subject", "Human id"], ["tool", "Tool"], ["decision", "Decision"], ["traceId", "Trace id"], ["sessionId", "Session id"]];

export default function EventsTab({ epoch, onOpen, selectedId }) {
  const [draft, setDraft] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const [cursors, setCursors] = useState([""]); // cursor that fetches page i
  const [page, setPage] = useState(0);
  const [data, setData] = useState(null);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async (filters, cursor, pageIdx) => {
    const me = ++seq.current; setBusy(true); setError("");
    try {
      const [d, s] = await Promise.all([searchEvents({ ...filters, cursor }), getSummary(filters.days)]);
      if (me !== seq.current) return;
      setData(d); setSummary(s);
      setCursors((c) => { const n = c.slice(0, pageIdx + 1); if (d.nextCursor) n[pageIdx + 1] = d.nextCursor; return n; });
    } catch (e) { if (me === seq.current) { setError(`Search failed: ${e.message}`); setData(null); } } finally { if (me === seq.current) setBusy(false); }
  }, []);

  useEffect(() => { setCursors([""]); setPage(0); load(applied, "", 0); }, [applied, epoch, load]);

  const apply = (e) => { e.preventDefault(); if (!busy) setApplied({ ...draft }); };
  const clear = () => { setDraft(EMPTY); setApplied(EMPTY); };
  const go = (i) => { setPage(i); load(applied, cursors[i] || "", i); };
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const hasNext = !!data?.nextCursor;

  return (
    <section aria-labelledby="events-title">
      <h2 id="events-title">Event search <span className="muted">audit tool: search_audit_activities</span></h2>
      <form className="card filters" onSubmit={apply} aria-label="Event filters">
        <label>Source
          <select aria-label="Source" value={draft.source} onChange={set("source")}><option value="">any</option>{SOURCES.map((s) => <option key={s}>{s}</option>)}</select>
        </label>
        {TEXT_FIELDS.map(([k, label]) => <label key={k}>{label}<input value={draft[k]} onChange={set(k)} maxLength={80} autoComplete="off" spellCheck="false" /></label>)}
        <label>Correlation
          <select aria-label="Correlation" value={draft.orphaned} onChange={set("orphaned")}><option value="">all</option><option value="true">orphaned only</option><option value="false">correlated only</option></select>
        </label>
        <label>Days back
          <input aria-label="Days back" type="number" min="1" max="365" value={draft.days} onChange={set("days")} />
        </label>
        <label>Page size
          <select aria-label="Page size" value={draft.limit} onChange={set("limit")}>{["5", "10", "25", "50"].map((n) => <option key={n}>{n}</option>)}</select>
        </label>
        <div className="row fbtns">
          <button type="submit" className="primary" aria-disabled={busy ? "true" : undefined}>Search</button>
          <button type="button" onClick={clear}>Clear</button>
        </div>
      </form>
      {error && <p className="alert" role="alert">{error}</p>}
      <div role="status" aria-live="polite" className="scan-status" data-testid="events-status">
        {data && `${data.count} of ${data.total} events on page ${page + 1}`}
      </div>
      {data?.clamped && <p className="note-clamp" role="note" data-testid="clamp-note"><strong>Clamped.</strong> <Untrusted text={data.note} /></p>}
      {data && (
        <div className="table-wrap">
          <table className="inv" aria-label="Audit events">
            <thead><tr><th>Time</th><th>Source</th><th>Type</th><th>Agent</th><th>Human</th><th>Tool</th><th>Decision</th><th>Trace</th><th>Summary</th></tr></thead>
            <tbody>
              {data.events.length === 0 && <tr><td colSpan="9" className="muted">No events match. Nothing matched in the window shown above, which is not proof nothing happened outside it.</td></tr>}
              {data.events.map((e) => (
                <tr key={e.id} className={e.id === selectedId ? "sel" : ""} data-testid="event-row">
                  <td className="mono nowrap">{clock(e.recordedAt)}</td>
                  <td>{e.source}</td>
                  <td className="mono">{e.type}</td>
                  <td className="mono"><Untrusted text={e.actor ?? "-"} /></td>
                  <td className="mono"><Untrusted text={e.subject ?? "-"} /></td>
                  <td className="mono"><Untrusted text={e.tool ?? "-"} /></td>
                  <td><Decision value={e.decision} /></td>
                  <td className="mono">{e.traceId ? e.traceId.slice(0, 8) : <span className="badge badge--orphan">{e.sessionId ? "session only" : "orphan"}</span>}</td>
                  <td><button type="button" className="linkbtn" onClick={() => onOpen(e.id)} aria-label={`Open raw event ${e.id}: ${e.summary}`}><Untrusted text={e.summary} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="row pager">
        <button type="button" aria-disabled={busy || page === 0 ? "true" : undefined} onClick={() => { if (!busy && page > 0) go(page - 1); }}>Previous page</button>
        <button type="button" aria-disabled={busy || !hasNext ? "true" : undefined} onClick={() => { if (!busy && hasNext) go(page + 1); }}>Next page</button>
        <span className="muted small">Cursor pagination: the server returns <code>nextCursor</code>; page size is capped at 200 server-side.</span>
      </div>
      {summary && (
        <div className="card" data-testid="summary">
          <h3>Summary <span className="muted small">audit tool: audit_summary, last {summary.windowDays} day(s)</span></h3>
          <p className="small">{summary.total} events, {summary.traces} traces, <strong>{summary.orphaned}</strong> events with no trace id. These are counts of what this store holds, <UnverifiedBadge>retention UNVERIFIED</UnverifiedBadge></p>
          <div className="counts">
            {Object.entries(summary.bySource).map(([k, v]) => <span key={k} className="count"><strong>{v}</strong> {k}</span>)}
          </div>
        </div>
      )}
    </section>
  );
}

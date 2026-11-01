import React from "react";
import { clock, nameOf, plural } from "../lib/format.js";
import { Decision } from "./Badges.jsx";
import { Untrusted } from "./Untrusted.jsx";

// "Who did what through which agent". Everything here is read from the join response, which is built only from
// event fields. The chain below is drawn from delegation.chain; a name appears only if some event in the timeline carries it.
export function Chain({ join }) {
  const tl = join.timeline;
  const d = join.delegation;
  const toolEv = [...tl].reverse().find((e) => e.tool);
  const human = d?.subject;
  const nodes = [
    { kind: "human", id: human, name: nameOf(tl, human), missing: !human },
    ...(d?.chain || []).map((a) => ({ kind: "agent", id: a, name: nameOf(tl, a) })),
    ...(toolEv ? [{ kind: "tool", id: toolEv.tool, name: null }] : []),
  ];
  return (
    <ol className="chain" aria-label={`Delegation chain: ${d?.text || "no delegation recorded"}`} data-testid="chain">
      {nodes.map((n, i) => (
        <li key={`${n.kind}-${i}`} className={`chain-node chain-node--${n.kind}${n.missing ? " chain-node--missing" : ""}`}>
          <span className="chain-kind">{n.missing ? "no human recorded" : n.kind === "human" ? "human" : n.kind === "agent" ? `agent${(d.chain.length > 1) ? ` (hop ${nodes.filter((x, j) => j <= i && x.kind === "agent").length})` : ""}` : "tool"}</span>
          {n.missing ? <strong>?</strong> : <strong><Untrusted text={n.name || n.id} /></strong>}
          {!n.missing && n.name && <span className="mono muted"><Untrusted text={n.id} /></span>}
          {i < nodes.length - 1 && <span className="chain-arrow" aria-hidden="true">{"→"}</span>}
        </li>
      ))}
    </ol>
  );
}

export function Timeline({ join, onOpen }) {
  return (
    <ol className="timeline" aria-label="Per-action timeline" data-testid="timeline">
      {join.timeline.map((e) => (
        <li key={e.id} className={`tl tl--${e.link}`} data-testid="tl-item">
          <div className="tl-top">
            <span className="mono tl-time">+{(e.offsetMs / 1000).toFixed(1)}s</span>
            <span className="tl-hop">{e.hop}</span>
            <span className="tl-src muted">{e.source} / {e.type}</span>
            <span className={`badge badge--link-${e.link}`} title={e.link === "trace" ? "Joined by the trace id in this event" : e.link === "session-inferred" ? "No trace id on this event; attached by session id and time window. An inference, not proof." : "No correlation id"}>
              {e.link === "trace" ? "trace id" : e.link === "session-inferred" ? "session-inferred" : e.link}
            </span>
            <Decision value={e.decision?.result} />
          </div>
          <div className="tl-sum"><Untrusted text={e.summary} /></div>
          <div className="tl-meta muted small">
            <button type="button" className="linkbtn mono" onClick={() => onOpen(e.id)} aria-label={`Open raw event ${e.id}`}>{e.id}</button>
            <span title={e.recordedAt}>{clock(e.recordedAt)}</span>
            {e.flags?.length > 0 && e.flags.map((f) => <span key={f} className="badge badge--flag">{f}</span>)}
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function WhoPanel({ join, error, onOpen, headingRef }) {
  if (error) return <section className="card" aria-labelledby="who-title"><h2 id="who-title" tabIndex={-1} ref={headingRef}>Who did what</h2><p className="alert" role="alert">{error}</p></section>;
  if (!join) return (
    <section className="card empty" aria-labelledby="who-title">
      <h2 id="who-title" tabIndex={-1} ref={headingRef}>Who did what, through which agent</h2>
      <p>Pick a scenario and press Run. The audit tools will be queried and the events joined into one story.</p>
    </section>
  );
  const present = join.hops.filter((h) => h.present).length;
  const inferred = join.hops.filter((h) => h.present && h.inferredOnly).length;
  return (
    <section className="card who" aria-labelledby="who-title" data-testid="who">
      <h2 id="who-title" tabIndex={-1} ref={headingRef}>Who did what, through which agent</h2>
      <div className="badges">
        {join.orphan && <span className="badge badge--orphan" data-testid="orphan-badge">ORPHAN: no correlation id</span>}
        {join.ambiguous && <span className="badge badge--orphan">AMBIGUOUS: session matches more than one trace</span>}
        {join.gaps.length > 0 && <span className="badge badge--gap" data-testid="gap-badge">{plural(join.gaps.length, "gap")}</span>}
        {!join.orphan && join.gaps.length === 0 && <span className="badge badge--ok">no gaps found</span>}
        <span className="badge badge--info">{plural(join.timeline.length, "event")}, {present} of {join.hops.length} hops present{inferred > 0 ? ` (${inferred} by session id only)` : ""}</span>
      </div>
      <p className="sentence" data-testid="sentence"><Untrusted text={join.sentence} /></p>
      <p className="muted small">Built only from fields in the events. Each fact below cites the event ids it came from.</p>
      <h3>Delegation chain</h3>
      <Chain join={join} />
      <h3>Facts and their evidence</h3>
      <ul className="facts">
        {join.facts.map((f, i) => (
          <li key={i} className={f.negative ? "fact fact--neg" : "fact"}>
            <Untrusted text={f.text} />{" "}
            {f.negative && <span className="badge badge--gap">absence</span>}{" "}
            {f.evidence.map((id) => <button key={id} type="button" className="linkbtn mono" onClick={() => onOpen(id)}>{id}</button>)}
          </li>
        ))}
      </ul>
      <h3>Hops</h3>
      <ul className="hops" aria-label="Hops present or missing">
        {join.hops.map((h) => (
          <li key={h.hop} className={h.present ? "hop hop--yes" : "hop hop--no"}><span aria-hidden="true">{h.present ? "●" : "○"}</span> {h.hop}{h.present && h.inferredOnly && " (session-inferred)"}<span className="sr-only">{h.present ? " present" : " not recorded"}</span></li>
        ))}
      </ul>
      {join.gaps.length > 0 && (
        <div className="gaps" role="note">
          <strong>Gaps (missing hops, shown not hidden)</strong>
          <ul>{join.gaps.map((g, i) => <li key={i}><span className="mono">{g.hop}</span> <Untrusted text={g.message} /></li>)}</ul>
        </div>
      )}
      <h3>Timeline</h3>
      <Timeline join={join} onOpen={onOpen} />
      {join.notes?.length > 0 && <ul className="notes small muted">{join.notes.map((n, i) => <li key={i}><Untrusted text={n} /></li>)}</ul>}
      {join.possiblyRelated?.length > 0 && <p className="small muted">Possibly related (not joined): {join.possiblyRelated.length}</p>}
    </section>
  );
}

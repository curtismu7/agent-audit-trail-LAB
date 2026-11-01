import React from "react";
import { pretty } from "../lib/format.js";
import { Decision, MockTokenBadge } from "./Badges.jsx";
import { Untrusted } from "./Untrusted.jsx";

// Raw viewer: the normalized envelope next to the source's own raw shape, both as inert text. Token claims are
// shown whole on purpose (they are mock-issued); the badge says so.
export default function RawEvent({ event, error, headingRef, onJoin, onClose }) {
  if (error) return <aside className="card" aria-label="Raw event"><p className="alert" role="alert">{error}</p></aside>;
  if (!event) return <aside className="card empty" aria-label="Raw event"><h3>Raw event</h3><p className="muted">Select an event id to see the normalized envelope and the source's raw record.</p></aside>;
  const { raw, mode, ...envelope } = event; // eslint-disable-line no-unused-vars
  const isToken = event.source === "token" || /mock/i.test(JSON.stringify(raw ?? {}).slice(0, 4000));
  return (
    <aside className="card rawev" aria-labelledby="raw-title" data-testid="raw-event">
      <div className="row between">
        <h3 id="raw-title" tabIndex={-1} ref={headingRef}>Raw event <span className="mono">{event.id}</span></h3>
        <button type="button" onClick={onClose}>Close</button>
      </div>
      <div className="badges">
        {isToken && <MockTokenBadge />}
        <Decision value={event.decision?.result} />
        <span className="badge badge--info">{event.source} / {event.type}</span>
        {event.traceparent ? <span className="badge badge--ok">traceparent valid</span> : <span className="badge badge--gap">no valid traceparent</span>}
        {event.flags?.map((f) => <span key={f} className="badge badge--flag">{f}</span>)}
      </div>
      <div className="row">
        <button type="button" onClick={() => onJoin(event)}>{event.traceId ? "Join by trace id" : "Join this event"}</button>
      </div>
      <h4>Normalized envelope</h4>
      <Untrusted block text={pretty(envelope)} />
      <h4>Source raw record</h4>
      <Untrusted block text={pretty(raw)} />
    </aside>
  );
}

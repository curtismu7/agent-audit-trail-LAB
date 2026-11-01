import React, { useCallback, useEffect, useState } from "react";
import { getRetentionDemo } from "../lib/api.js";
import { UnverifiedBadge } from "./Badges.jsx";
import { Untrusted } from "./Untrusted.jsx";

export default function RetentionTab({ epoch }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(async (d) => {
    try { setError(""); setData(await getRetentionDemo(d)); } catch (e) { setData(null); setError(`Could not load: ${e.message}`); }
  }, []);
  useEffect(() => { load(days); }, [days, epoch, load]);
  return (
    <section aria-labelledby="ret-title">
      <h2 id="ret-title">Retention window <UnverifiedBadge /></h2>
      <p>The audit store keeps about <strong>7 days</strong>. That figure is <strong>as observed in the demo environment, UNVERIFIED against product documentation</strong>. This app makes no claim about real retention, field names or latency.</p>
      <div className="card controls">
        <label>Ask for how many days back
          <input type="range" min="1" max="60" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-valuetext={`${days} days`} />
        </label>
        <output className="bigdays" data-testid="days-out">{days} days</output>
      </div>
      {error && <p className="alert" role="alert">{error}</p>}
      {data && (
        <div className="cmp">
          <div className="card cmp-bad" data-testid="naive">
            <h3>The trap: a naive upstream</h3>
            <p className="big">{data.naiveUpstream.count} events</p>
            <p className="small"><Untrusted text={data.naiveUpstream.note} /></p>
            <p className="small muted">Window it used: {data.naiveUpstream.windowDays} days. No error. No warning.</p>
          </div>
          <div className="card cmp-good" data-testid="tool-answer">
            <h3>This audit tool: clamped and said so</h3>
            <p className="big">{data.auditTool.count} events</p>
            <p className="small"><Untrusted text={data.auditTool.note || `Within the ${data.retentionDays}-day window. Nothing was clamped.`} /></p>
            <p className="small muted">Window it used: {data.auditTool.windowDays} days. {data.auditTool.clamped ? "Clamped." : "Not clamped."}</p>
          </div>
        </div>
      )}
      {data && <p className="small muted">The store holds {data.storedBeyondRetention} synthetic events older than the window; the tool will not return them, and says why.</p>}
      <p className="lesson">Lesson: an empty answer past the retention edge means <strong>outside retention</strong>, not <strong>nothing happened</strong>. Treat zero events as a question to ask, not as proof.</p>
    </section>
  );
}

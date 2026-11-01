import React, { useEffect, useState } from "react";
import { rpc } from "../lib/api.js";
import { pretty } from "../lib/format.js";
import { ModelBadge, UnverifiedBadge } from "./Badges.jsx";
import { Untrusted } from "./Untrusted.jsx";

const EXAMPLES = {
  search_audit_activities: { days: 30, limit: 3, source: "gateway" },
  get_audit_activity: { activityId: "ev-000001" },
  audit_summary: {},
};

export default function ToolsTab({ epoch }) {
  const [list, setList] = useState(null);
  const [name, setName] = useState("search_audit_activities");
  const [args, setArgs] = useState(pretty(EXAMPLES.search_audit_activities));
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const fetchList = async () => {
    setBusy(true); setError("");
    try { setList(await rpc("tools/list")); } catch (e) { setError(`tools/list failed: ${e.message}`); } finally { setBusy(false); }
  };
  useEffect(() => { fetchList(); }, [epoch]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (n) => { setName(n); setArgs(pretty(EXAMPLES[n] ?? {})); setResult(null); };
  const call = async () => {
    let parsed;
    try { parsed = JSON.parse(args || "{}"); } catch { setError("Arguments are not valid JSON."); return; }
    setBusy(true); setError("");
    try { setResult(await rpc("tools/call", { name, arguments: parsed })); } catch (e) { setError(`tools/call failed: ${e.message}`); } finally { setBusy(false); }
  };
  const tools = list?.response?.result?.tools || [];

  return (
    <section aria-labelledby="tools-title">
      <h2 id="tools-title">The audit tool surface <ModelBadge /></h2>
      <p className="lesson" data-testid="readonly-lesson">The audit surface exposes exactly what is implemented: <strong>three read-only tools</strong>. There is no write, delete or reset tool to find. Demo controls (Run, Reset, tamper) are buttons for the presenter, not tools an agent can call.</p>
      <p className="small muted">The shape follows the three tools of the original demo's audit server. Retention and field names are <UnverifiedBadge>UNVERIFIED</UnverifiedBadge> against product documentation.</p>
      <div className="card">
        <h3>tools/list <span className="muted small">POST /mcp, JSON-RPC 2.0</span></h3>
        <div role="status" aria-live="polite" className="small" data-testid="tool-count">{list ? `${tools.length} tools advertised` : "loading"}</div>
        <ul className="toollist">
          {tools.map((t) => (
            <li key={t.name}>
              <button type="button" aria-pressed={t.name === name} onClick={() => pick(t.name)}><span className="mono">{t.name}</span></button>
              <span className="small muted"> <Untrusted text={t.description.split(". ")[0]} /></span>
            </li>
          ))}
        </ul>
      </div>
      <div className="card">
        <h3>tools/call</h3>
        <label className="stack">Arguments for <span className="mono">{name}</span> (JSON)
          <textarea value={args} onChange={(e) => setArgs(e.target.value)} rows={5} spellCheck="false" className="mono" aria-label="Tool arguments as JSON" />
        </label>
        <div className="row"><button type="button" className="primary" onClick={() => { if (!busy) call(); }} aria-disabled={busy ? "true" : undefined}>Call tool</button></div>
        {error && <p className="alert" role="alert">{error}</p>}
        {result && (
          <div className="rpc" data-testid="rpc-result">
            <h4>Request</h4><Untrusted block text={pretty(result.request)} />
            <h4>Response</h4><Untrusted block text={pretty(result.response)} />
          </div>
        )}
      </div>
    </section>
  );
}

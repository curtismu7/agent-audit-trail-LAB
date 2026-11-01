import React, { useState } from "react";
import { tamperDemo, verifyChain } from "../lib/api.js";
import { shortHash } from "../lib/format.js";
import { ModelBadge } from "./Badges.jsx";

const KINDS = { edit: "Edit one event", "edit-and-rehash": "Edit and re-hash that entry", delete: "Delete an entry", insert: "Insert an entry", reorder: "Reorder two entries", truncate: "Cut off the newest entries" };

export function VerdictLine({ v, label }) {
  if (!v) return null;
  return (
    <p className={`verify ${v.ok ? "verify--ok" : "verify--bad"}`} data-testid={`verdict-${label}`}>
      {v.ok ? `✓ ${label}: chain verified, ${v.length} entries.` : `✕ ${label}: TAMPERED at entry #${v.firstBadSeq ?? "?"} (${v.reason}).`}
    </p>
  );
}

export default function IntegrityTab({ epoch }) {
  const [verify, setVerify] = useState(null);
  const [kind, setKind] = useState("edit");
  const [demo, setDemo] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn, set) => { setBusy(true); setError(""); try { set(await fn()); } catch (e) { setError(`Failed: ${e.message}`); } finally { setBusy(false); } };

  return (
    <section aria-labelledby="int-title" key={epoch}>
      <h2 id="int-title">Tamper evidence <ModelBadge /></h2>
      <p>Every event is appended to a hash chain: each entry commits to the one before it with an HMAC. Change, remove, insert or reorder anything and verification fails at the first entry that no longer fits. Cutting off the newest entries is caught only by the separately held head checkpoint.</p>
      <div className="card">
        <h3>Verify the live store</h3>
        <button type="button" className="primary" aria-disabled={busy ? "true" : undefined} onClick={() => { if (!busy) run(verifyChain, setVerify); }}>Verify chain</button>
        <div aria-live="polite" className="verify-slot">
          <VerdictLine v={verify} label="live store" />
          {verify?.ok && <p className="small muted mono">head #{verify.headSeq} {shortHash(verify.headHash)}</p>}
        </div>
      </div>
      <div className="card">
        <h3>Tamper demo <span className="muted small">works on a copy; the live store is never touched</span></h3>
        <div className="controls">
          <label>What the attacker does
            <select value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(KINDS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
          </label>
          <button type="button" aria-disabled={busy ? "true" : undefined} onClick={() => { if (!busy) run(() => tamperDemo(kind), setDemo); }}>Tamper with a copy</button>
        </div>
        {error && <p className="alert" role="alert">{error}</p>}
        <div aria-live="polite" className="verify-slot" data-testid="tamper-out">
          {demo && (
            <>
              {demo.change && <p className="small">Change: <span className="mono">{JSON.stringify(demo.change)}</span></p>}
              <VerdictLine v={demo.before} label="copy before" />
              <VerdictLine v={demo.after} label="copy after" />
              <VerdictLine v={demo.liveStoreVerify} label="live store" />
              <p className="small muted">{demo.realStoreTouched ? "The live store was changed." : "The live store was not touched."}</p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

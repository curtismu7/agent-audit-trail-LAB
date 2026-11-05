import React, { useCallback, useEffect, useRef, useState } from "react";
import ShelfLink from "./components/ShelfLink.jsx";
import { workspaceId } from "./lib/api.js";
import { getDiagram, getEvent, getHealth, getInfo, getJoin, getScenarios, postReset, runScenario, searchEvents, verifyChain } from "./lib/api.js";
import { plural, safe } from "./lib/format.js";
import { UnverifiedBadge } from "./components/Badges.jsx";
import EventsTab from "./components/EventsTab.jsx";
import Flow, { startPositions } from "./components/Flow.jsx";
import IntegrityTab from "./components/IntegrityTab.jsx";
import RawEvent from "./components/RawEvent.jsx";
import RetentionTab from "./components/RetentionTab.jsx";
import Story from "./components/Story.jsx";
import ToolsTab from "./components/ToolsTab.jsx";
import WhoPanel from "./components/WhoPanel.jsx";

const initialTheme = () => safe(() => localStorage.getItem("aat-theme"), null)
  || (safe(() => window.matchMedia("(prefers-color-scheme: dark)").matches, false) ? "dark" : "light");
const FALLBACK_BANNER = "SIMULATION, MOCK mode: every event here is synthetic and seeded. No tenant, no network, no credentials. Tokens shown are mock-issued claims.";
const FALLBACK_LIVE_REFUSAL = "Live mode is not available in this app: it has no live audit source to connect to, and everything shown is a seeded mock. The page stays in mock mode.";
const TABS = [["story", "Story"], ["events", "Events"], ["retention", "Retention"], ["tools", "Tools"], ["integrity", "Integrity"], ["diagram", "Diagram"]];
const isTyping = (t) => !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);

export default function App() {
  const [theme, setTheme] = useState(initialTheme);
  const [presenter, setPresenter] = useState(false);
  const [tab, setTab] = useState("story");
  const [info, setInfo] = useState(null);
  const [health, setHealth] = useState(null);
  const [scenarios, setScenarios] = useState([]);
  const [scenarioId, setScenarioId] = useState("");
  const [join, setJoin] = useState(null);
  const [joinError, setJoinError] = useState("");
  const [raw, setRaw] = useState(null);
  const [rawError, setRawError] = useState("");
  const [sim, setSim] = useState(null);
  const [diagram, setDiagram] = useState(null);
  const [diagramError, setDiagramError] = useState("");
  const [boxes, setBoxes] = useState(null); // lifted so box positions survive a tab switch
  const [epoch, setEpoch] = useState(0);
  const [resetKey, setResetKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [liveNote, setLiveNote] = useState("");
  const [storyNow, setStoryNow] = useState(-1);
  const whoHeading = useRef(null);
  const rawHeading = useRef(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    safe(() => localStorage.setItem("aat-theme", theme));
  }, [theme]);

  // Presenter mode: P toggles, Escape leaves. Keys typed into a field, held keys and any chord with Ctrl, Meta or Alt are ignored.
  useEffect(() => {
    const on = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTyping(e.target)) return;
      if (e.key === "p" || e.key === "P") setPresenter((v) => !v);
      else if (e.key === "Escape") setPresenter(false);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const refreshInfo = useCallback(() => getInfo().then(setInfo, () => setInfo(null)), []);
  useEffect(() => {
    getHealth().then(setHealth, () => setHealth({ unreachable: true }));
    refreshInfo();
    getScenarios().then((d) => { setScenarios(d.scenarios); setScenarioId(d.scenarios[0]?.id || ""); }, (e) => setError(`Could not load the scenarios: ${e.message}`));
    getDiagram().then((d) => { setDiagram(d.diagram); setBoxes(startPositions(d.diagram)); }, (e) => setDiagramError(e.message));
  }, [refreshInfo]);

  const openRaw = useCallback(async (id) => {
    setRawError(""); setRaw(null);
    try { setRaw(await getEvent(id)); } catch (e) { setRawError(`Could not load ${id}: ${e.message}`); }
    setTimeout(() => rawHeading.current?.focus(), 0);
  }, []);

  const loadJoin = useCallback(async (q, focus = false) => {
    setJoinError("");
    try { const j = await getJoin(q); setJoin(j); if (focus) setTimeout(() => whoHeading.current?.focus(), 0); return j; } catch (e) { setJoin(null); setJoinError(`Join failed: ${e.message}`); return null; }
  }, []);

  const joinFromEvent = (ev) => { setTab("story"); loadJoin(ev.traceId ? { traceId: ev.traceId } : { eventId: ev.id }, true); };

  // One real pass: run the scenario, query the audit tool for it, join it, verify the chain.
  const go = useCallback(async () => {
    if (busy || !scenarioId) return null;
    setBusy(true); setError(""); setMessage("Running");
    try {
      const run = await runScenario(scenarioId);
      const title = scenarios.find((s) => s.id === scenarioId)?.title || scenarioId;
      let query;
      if (run.traceId) {
        const r = await searchEvents({ traceId: run.traceId, days: 7, limit: 200 });
        query = { tool: "search_audit_activities", argLabel: `traceId=${run.traceId.slice(0, 8)}...`, count: r.count, clamped: r.clamped };
      } else {
        await getEvent(run.focusEventId);
        query = { tool: "get_audit_activity", argLabel: `activityId=${run.focusEventId}`, count: 1, clamped: false };
      }
      const j = await loadJoin(run.traceId ? { traceId: run.traceId } : { eventId: run.focusEventId }, false);
      const verify = await verifyChain();
      await refreshInfo();
      setRaw(null);
      const result = j ? { run, join: j, query, verify, scenarioTitle: title } : null;
      setSim(result);
      setMessage(j ? `Ran "${title}": ${plural(run.eventIds.length, "event")} joined into ${`${j.timeline.length} timeline ${j.timeline.length === 1 ? "entry" : "entries"}`}${j.orphan ? ", ORPHANED (no correlation id)" : ""}, ${plural(j.gaps.length, "gap")}.` : "");
      return result;
    } catch (e) { setMessage(""); setError(`Run failed: ${e.message}`); return null; } finally { setBusy(false); }
  }, [busy, scenarioId, scenarios, loadJoin, refreshInfo]);

  const reset = async (vertical) => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await postReset(typeof vertical === "string" ? vertical : undefined);
      if (typeof vertical === "string") setScenarios((await getScenarios()).scenarios);
      setJoin(null); setJoinError(""); setRaw(null); setRawError(""); setSim(null); setStoryNow(-1);
      if (diagram) setBoxes(startPositions(diagram));
      setEpoch((n) => n + 1); setResetKey((n) => n + 1);
      await refreshInfo();
      setMessage("Reset: a fresh seeded store and a new hash chain. Diagram boxes are back where they started.");
    } catch (e) { setError(`Reset failed: ${e.message}`); } finally { setBusy(false); }
  };

  const dark = theme === "dark";
  const scenario = scenarios.find((s) => s.id === scenarioId);
  const counts = {
    sources: sim ? sim.run.eventIds.length : undefined,
    normalizer: sim ? sim.join.timeline.length : undefined,
    store: info?.events, tools: sim ? sim.query.count : undefined, join: sim ? sim.join.timeline.length : undefined,
  };
  const rawPane = <RawEvent event={raw} error={rawError} headingRef={rawHeading} onJoin={joinFromEvent} onClose={() => { setRaw(null); setRawError(""); }} />;

  return (
    <div className={presenter ? "app app--presenter" : "app"} data-testid="app">
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>Skip to content</a>
      <section className="banner" data-state="mock" aria-label="Simulation notice" data-testid="sim-banner">
        <strong>SIMULATION, MOCK mode:</strong>{" "}
        <span>{(info?.banner || FALLBACK_BANNER).replace(/^SIMULATION, MOCK mode:\s*/, "")}</span>{" "}
        <UnverifiedBadge>retention ~{info?.retentionDays ?? 7} days UNVERIFIED</UnverifiedBadge>
      </section>
      {health?.unreachable && <p className="notice" role="alert">Cannot reach the API. Is the server running?</p>}
      {health && !health.unreachable && health.state !== "ready" && <p className="notice" role="alert">Server health is {health.state}. Run <code>npm run doctor</code>.</p>}
      <header className="top">
        <h1>{info?.customer?.brand?.title ?? "Agent Audit Trail"}</h1>
        <span className="chip chip--demo" data-testid="mode-badge">DEMO<span className="sr-only">: seeded synthetic events, nothing real</span></span>
        <div className="seg" role="group" aria-label="Mode">
          <button type="button" aria-pressed="true" onClick={() => setLiveNote("")} data-testid="mode-mock">Mock</button>
          <button type="button" aria-pressed="false" onClick={() => setLiveNote(info?.liveRefusal || FALLBACK_LIVE_REFUSAL)} data-testid="mode-live">Live</button>
        </div>
        <span className="chip" data-testid="mode-header">mode: {info?.mode ?? "mock"}</span>
        <nav aria-label="Views" className="tabs">
          {TABS.map(([id, label]) => <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}
        </nav>
        <div className="tools-right">
            <ShelfLink headers={() => ({ "X-Workspace-Id": workspaceId() })} />
          <button type="button" aria-pressed={presenter} onClick={() => setPresenter((p) => !p)}>{presenter ? "Exit presenter mode (Esc)" : "Presenter mode (P)"}</button>
          <button type="button" onClick={() => reset()} aria-disabled={busy ? "true" : undefined}>Reset</button>
          <button type="button" onClick={() => setTheme(dark ? "light" : "dark")} aria-label={`Switch to ${dark ? "light" : "dark"} theme`}>{dark ? "Light" : "Dark"}</button>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="page">
        <p className="notice" role="status" aria-live="polite" data-testid="live-note" hidden={!liveNote}>{liveNote}</p>
        <section className="card picker" aria-label="Run a scenario">
          <label htmlFor="scenario-select">Scenario</label>
          <div className="field">
            <select id="scenario-select" value={scenarioId} onChange={(e) => setScenarioId(e.target.value)} disabled={!scenarios.length}>
              {scenarios.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </div>
          <label htmlFor="vertical-select">Cast</label>
          <div className="field">
            <select id="vertical-select" value={info?.vertical ?? "retail"} onChange={(e) => reset(e.target.value)} disabled={!info?.verticals}>
              {(info?.verticals ?? ["retail"]).map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          {/* aria-disabled, not disabled: a disabled button drops keyboard focus to the page while the run is in flight. */}
          <button type="button" className="primary" onClick={go} aria-disabled={busy || !scenarioId ? "true" : undefined}>Run</button>
          {scenario && <p className="desc" data-testid="scenario-story"><span>{scenario.story}</span> <strong className="muted">Lesson: {scenario.lesson}</strong></p>}
        </section>
        <div role="status" aria-live="polite" className="scan-status" data-testid="run-status">{message}</div>
        {error && <p className="alert" role="alert">{error}</p>}

        {tab === "story" && (
          <div className="workspace">
            <WhoPanel join={join} error={joinError} onOpen={openRaw} headingRef={whoHeading} />
            {rawPane}
          </div>
        )}
        {tab === "events" && (
          <div className="workspace workspace--wide">
            <EventsTab epoch={epoch} onOpen={openRaw} selectedId={raw?.id} />
            {rawPane}
          </div>
        )}
        {tab === "retention" && <RetentionTab epoch={epoch} />}
        {tab === "tools" && <ToolsTab epoch={epoch} />}
        {tab === "integrity" && <IntegrityTab epoch={epoch} />}
        {tab === "diagram" && <Flow diagram={diagram} error={diagramError} boxes={boxes} setBoxes={setBoxes} sim={sim} counts={counts} scenarioTitle={scenario?.title} busy={busy} resetKey={resetKey} onSimulate={go} onStep={setStoryNow} />}
        <Story active={tab === "diagram" ? storyNow : -1} />
      </main>
    </div>
  );
}

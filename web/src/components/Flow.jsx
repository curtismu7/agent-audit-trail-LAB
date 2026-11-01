import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Background, BackgroundVariant, BaseEdge, Controls, EdgeLabelRenderer, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, getBezierPath, useReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { plural } from "../lib/format.js";

// The diagram is diagram-studio/1 DATA loaded by name from the server (rule 17): nothing here builds nodes or edges by hand.
// Boxes are draggable (and keyboard movable); Reset restores their start positions (taken from the data). Simulate runs the
// selected scenario for real, queries the audit tool for it, joins it, and walks the diagram's steps with the real numbers.
export const startPositions = (diagram) => Object.fromEntries(diagram.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
const SPEEDS = [["0.5", "0.5x"], ["1", "1x"], ["2", "2x"], ["4", "4x"]];
const BASE_MS = 1800;
const HANDLES = [["t", Position.Top], ["b", Position.Bottom], ["l", Position.Left], ["r", Position.Right]];
const FIT = { padding: 0.1 };

// What each step is focused on, from the data: the boxes at both ends of its arrows; a step with no arrow focuses the first box.
export function focusOf(diagram, step) {
  const edges = (step.edges || []).map((i) => diagram.edges[i]).filter(Boolean);
  return { edges: step.edges || [], nodes: edges.length ? [...new Set(edges.flatMap((e) => [e.source, e.target]))] : [diagram.nodes[0].id] };
}

// The sentence for each of the five steps, quoting the numbers of one real simulation: { run, join, query, verify, scenarioTitle }.
export function describeSteps(sim) {
  if (!sim?.join) return [];
  const { run, join, query, verify } = sim;
  const tl = join.timeline;
  const sources = [...new Set(tl.map((e) => e.source))];
  const withTrace = tl.filter((e) => e.traceId).length;
  const without = tl.length - withTrace;
  const hopsOn = join.hops.filter((h) => h.present).length;
  return [
    `"${sim.scenarioTitle}" emitted ${plural(run.eventIds.length, "raw record")} from ${plural(sources.length, "source")} (${sources.join(", ")}), each in its own shape.`,
    `The normalizer turned them into one envelope each: ${withTrace} carry a trace id, ${without} do not${without ? " (kept, and shown as session-linked or orphaned)" : ""}.`,
    `They were appended to the hash chain. Verify says ${verify?.ok ? `ok, ${verify.length} entries` : "NOT ok"}.`,
    `The read-only tool ${query.tool}(${query.argLabel}) returned ${plural(query.count, "event")}${query.clamped ? " (window clamped, and the result says so)" : ""}.`,
    `The join built a timeline of ${plural(tl.length, "event")}, ${hopsOn} of ${join.hops.length} hops present${join.hops.some((h) => h.present && h.inferredOnly) ? " (some by session id only)" : ""}, ${plural(join.gaps.length, "gap")}${join.orphan ? ", and flagged the event as orphaned" : ""}.`,
  ];
}

function Box({ data }) {
  return (
    <div className="fbox" data-color={data.color} data-on={data.on ? "true" : "false"} data-dim={data.dim ? "true" : "false"}>
      {HANDLES.map(([k, pos]) => (
        <span key={k}>
          <Handle id={`s-${k}`} type="source" position={pos} className="fbox__handle" />
          <Handle id={`t-${k}`} type="target" position={pos} className="fbox__handle" />
        </span>
      ))}
      <strong>{data.label}</strong>
      {data.sub.map((line) => <span key={line} className="fbox__sub">{line}</span>)}
      {data.count !== undefined && <span className="fbox__count">{data.count}</span>}
    </div>
  );
}
const nodeTypes = { box: Box };

// An edge that draws its own label as HTML, so the label can be checked for overlap.
function LabelEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data }) {
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        <div className="flabel" data-now={data.now ? "true" : "false"} style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}>{data.text}</div>
      </EdgeLabelRenderer>
    </>
  );
}
const edgeTypes = { label: LabelEdge };

// The sides of the two boxes that face each other, so an arrow leaves toward its target.
function sides(a, b) {
  const dx = b.x - a.x; const dy = b.y - a.y;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? ["r", "l"] : ["l", "r"]) : (dy > 0 ? ["b", "t"] : ["t", "b"]);
}

function Canvas({ diagram, positions, setPositions, counts, cur, refit }) {
  const { fitView } = useReactFlow();
  useEffect(() => { if (refit) fitView(FIT); }, [refit, fitView]);
  const colorOf = (g) => diagram.groups[g].color;
  const nodes = useMemo(() => diagram.nodes.map((n) => ({
    id: n.id, type: "box", position: positions[n.id], draggable: true,
    ariaLabel: `${n.label}: ${(n.sub || []).join(", ")}${counts?.[n.id] !== undefined ? `, ${counts[n.id]}` : ""}. Arrow keys move the box.`,
    data: { label: n.label, sub: n.sub || [], color: colorOf(n.group), count: counts?.[n.id], on: !!cur?.nodes.includes(n.id), dim: !!cur && !cur.nodes.includes(n.id) },
  })), [diagram, positions, counts, cur]); // eslint-disable-line react-hooks/exhaustive-deps
  const edges = useMemo(() => diagram.edges.map((e, i) => {
    const [a, b] = sides(positions[e.source], positions[e.target]);
    const now = !!cur?.edges.includes(i);
    return {
      id: `e${i}`, source: e.source, target: e.target, sourceHandle: `s-${a}`, targetHandle: `t-${b}`, type: "label", animated: now,
      data: { text: e.label || "", now }, className: now ? "fedge fedge--now" : "fedge", markerEnd: { type: MarkerType.ArrowClosed },
    };
  }), [diagram, positions, cur]);
  // Dragging and the arrow keys both arrive as position changes.
  const onNodesChange = useCallback((changes) => {
    const moves = changes.filter((c) => c.type === "position" && c.position);
    if (moves.length) setPositions((cur0) => ({ ...cur0, ...Object.fromEntries(moves.map((c) => [c.id, { x: c.position.x, y: c.position.y }])) }));
  }, [setPositions]);
  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange}
      fitView fitViewOptions={FIT} nodesConnectable={false} proOptions={{ hideAttribution: true }} minZoom={0.2}>
      <Background variant={BackgroundVariant.Dots} gap={18} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

export default function Flow({ diagram, error, boxes, setBoxes, sim, counts, scenarioTitle, busy, resetKey, onSimulate, onStep }) {
  const [speed, setSpeed] = useState("1");
  const [step, setStep] = useState(-1);
  const [running, setRunning] = useState(false);
  const [texts, setTexts] = useState([]);
  const [refit, setRefit] = useState(0);
  const total = diagram?.steps.length ?? 0;

  useEffect(() => {
    if (!running) return undefined;
    if (step >= total - 1) { setRunning(false); return undefined; }
    const t = setTimeout(() => setStep((s) => s + 1), BASE_MS / Number(speed));
    return () => clearTimeout(t);
  }, [running, step, total, speed]);
  useEffect(() => { onStep?.(step >= 0 ? step : -1); }, [step, onStep]);

  // Reset puts the walkthrough, the boxes and the view back. The header Reset raises resetKey, so it does the same.
  const reset = useCallback(() => {
    setRunning(false); setStep(-1); setTexts([]);
    if (diagram) { setBoxes(startPositions(diagram)); setRefit((n) => n + 1); }
  }, [diagram, setBoxes]);
  const seenKey = useRef(resetKey);
  useEffect(() => { if (seenKey.current !== resetKey) { seenKey.current = resetKey; reset(); } }, [resetKey, reset]);

  const simulate = async () => {
    if (busy || running || !diagram) return;
    setRunning(false); setStep(-1);
    const result = await onSimulate();
    if (!result) return;
    setTexts(describeSteps(result)); setStep(0); setRunning(true);
  };

  if (error) return <p className="alert" role="alert">Could not load the diagram ({error}).</p>;
  if (!diagram || !boxes) return <p className="muted">Loading the diagram...</p>;
  const cur = step >= 0 ? focusOf(diagram, diagram.steps[step]) : null;
  const caption = step >= 0 ? `Step ${step + 1} of ${total}: ${texts[step] ?? diagram.steps[step].what}` : "Press Simulate to run the selected scenario and walk through it step by step.";
  return (
    <section aria-labelledby="diagram-title">
      <h2 id="diagram-title" className="sr-only">Diagram</h2>
      <p className="muted">{diagram.lede}</p>
      <div className="card controls">
        <label>Speed
          <select value={speed} onChange={(e) => setSpeed(e.target.value)} data-testid="speed">
            {SPEEDS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </label>
        {/* aria-disabled, not disabled: a disabled button drops keyboard focus to the page while the run is in flight. */}
        <button type="button" className="primary" onClick={simulate} aria-disabled={busy || running ? "true" : undefined} data-testid="simulate">Simulate</button>
        <button type="button" onClick={reset} data-testid="reset-diagram">Reset diagram</button>
        <span className="muted">Simulate runs the selected scenario ({scenarioTitle || "none"}) for real, queries the audit tool for it and joins it, then walks through what happened. Drag any box; on a narrow screen scroll the diagram sideways to reach the others.</span>
      </div>
      <div className="flow-scroll" role="region" tabIndex={0} aria-label="Diagram area. On a narrow screen it scrolls sideways.">
        <div className="flow-wrap" role="group" aria-label={`Flow: ${diagram.nodes.map((n) => n.label).join(", ")}. Boxes can be dragged.`}>
          <ReactFlowProvider>
            <Canvas diagram={diagram} positions={boxes} setPositions={setBoxes} counts={counts} cur={cur} refit={refit} />
          </ReactFlowProvider>
        </div>
      </div>
      <p className="caption" role="status" aria-live="polite" data-testid="caption">{caption}</p>
    </section>
  );
}

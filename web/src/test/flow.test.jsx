import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Flow, { describeSteps, focusOf, startPositions } from "../components/Flow.jsx";
import { diagramFixture } from "./fixtures.js";

const diagram = diagramFixture();
const START = startPositions(diagram);
const props = (o = {}) => ({ diagram, boxes: START, setBoxes: vi.fn(), sim: null, counts: {}, scenarioTitle: "T", busy: false, resetKey: 0, onSimulate: vi.fn(), onStep: vi.fn(), ...o });
const SIM = { scenarioTitle: "T", run: { eventIds: ["a"] }, join: { timeline: [{ source: "gateway", traceId: "a" }], hops: [{ present: true }], gaps: [], orphan: false }, query: { tool: "x", argLabel: "y", count: 1, clamped: false }, verify: { ok: true, length: 1 } };

describe("Flow (diagram-studio/1 data)", () => {
  it("draws the boxes and arrows from the data, with no hand-built nodes", () => {
    render(<Flow {...props()} />);
    for (const n of diagram.nodes) expect(screen.getAllByText(n.label).length).toBeGreaterThan(0);
    expect(START).toEqual(Object.fromEntries(diagram.nodes.map((n) => [n.id, { x: n.x, y: n.y }])));
  });
  it("a step's focus comes from the data: its arrows' two ends, or the first box when it has no arrow", () => {
    expect(focusOf(diagram, diagram.steps[0])).toEqual({ edges: [], nodes: [diagram.nodes[0].id] });
    expect(focusOf(diagram, diagram.steps[2])).toEqual({ edges: [1], nodes: ["normalizer", "store"] });
    expect(describeSteps(SIM)).toHaveLength(diagram.steps.length);
    expect(describeSteps(null)).toEqual([]);
  });
  it("shows a clear message while the diagram loads and when it fails", () => {
    const { rerender } = render(<Flow {...props({ diagram: null, boxes: null })} />);
    expect(screen.getByText(/Loading the diagram/)).toBeInTheDocument();
    rerender(<Flow {...props({ diagram: null, boxes: null, error: "HTTP 500" })} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/Could not load the diagram \(HTTP 500\)/);
  });
});

describe("Flow reset", () => {
  it("the diagram Reset button restores the start positions", async () => {
    const p = props();
    render(<Flow {...p} />);
    await userEvent.click(screen.getByRole("button", { name: "Reset diagram" }));
    expect(p.setBoxes).toHaveBeenCalledWith(START);
  });
  it("an app-level reset (resetKey change) restores the start positions too", () => {
    const p = props();
    const { rerender } = render(<Flow {...p} />);
    expect(p.setBoxes).not.toHaveBeenCalled();
    rerender(<Flow {...p} resetKey={1} />);
    expect(p.setBoxes).toHaveBeenCalledWith(START);
  });
  it("Simulate runs the real pass and walks its steps", async () => {
    const p = props({ onSimulate: vi.fn(async () => SIM) });
    render(<Flow {...p} />);
    await userEvent.click(screen.getByRole("button", { name: "Simulate" }));
    expect(p.onSimulate).toHaveBeenCalled();
    expect(await screen.findByTestId("caption")).toHaveTextContent("Step 1 of 5");
    expect(screen.getByTestId("caption")).toHaveTextContent(/emitted 1 raw record from 1 source/);
  });
  it("Simulate uses aria-disabled while a pass is running, and does not start a second one", async () => {
    const p = props({ busy: true });
    render(<Flow {...p} />);
    const btn = screen.getByRole("button", { name: "Simulate" });
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(btn).not.toBeDisabled();
    await userEvent.click(btn);
    expect(p.onSimulate).not.toHaveBeenCalled();
  });
});

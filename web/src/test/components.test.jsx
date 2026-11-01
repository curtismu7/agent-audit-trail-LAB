import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import RawEvent from "../components/RawEvent.jsx";
import WhoPanel from "../components/WhoPanel.jsx";
import { Untrusted } from "../components/Untrusted.jsx";
import { describeSteps, focusOf } from "../components/Flow.jsx";
import { nameOf } from "../lib/format.js";
import { reveal } from "../lib/reveal.js";
import { diagramFixture, joinFixture } from "./fixtures.js";

const noop = () => {};
describe("inert text", () => {
  it("shows hidden characters as visible chips, client side too", () => {
    expect(reveal(`a${String.fromCharCode(0x200b)}b`)).toBe("a[U+200B]b");
    render(<Untrusted text={`x${String.fromCharCode(0x202e)}y`} />);
    expect(screen.getByText("[U+202E]")).toHaveClass("chip-hidden");
  });
  it("renders markup as text, never as elements", () => {
    const { container } = render(<Untrusted text={'<img src=x onerror="alert(1)"><b>hi</b>'} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("<img");
  });
});

describe("who did what panel", () => {
  it("says so when a hop rests on the session id alone", () => {
    const j = joinFixture();
    j.hops = [{ hop: "identity", present: true, eventIds: ["ev-1"], inferredOnly: true }, { hop: "gateway", present: true, eventIds: ["ev-2"], inferredOnly: false }];
    render(<WhoPanel join={j} onOpen={noop} />);
    expect(screen.getByLabelText("Hops present or missing")).toHaveTextContent("identity (session-inferred)");
    expect(screen.getByLabelText("Hops present or missing")).not.toHaveTextContent("gateway (session-inferred)");
    expect(screen.getByText(/2 of \d+ hops present \(1 by session id only\)/)).toBeInTheDocument();
  });
  it("draws human -> agent hops -> tool, with names only from the events", () => {
    render(<WhoPanel join={joinFixture()} onOpen={noop} />);
    const chain = screen.getByTestId("chain");
    const nodes = within(chain).getAllByRole("listitem");
    expect(nodes).toHaveLength(4);
    expect(nodes[0]).toHaveTextContent("Xavier Example");
    expect(nodes[1]).toHaveTextContent("Agent A");
    expect(nodes[2]).toHaveTextContent("agent-b"); // no event names it: the id is shown, nothing invented
    expect(nodes[2]).not.toHaveTextContent(/Agent B/i);
    expect(nodes[3]).toHaveTextContent("t.call");
    expect(nameOf(joinFixture().timeline, "agent-b")).toBeNull();
  });
  it("marks an orphan and a missing human", () => {
    render(<WhoPanel join={joinFixture({ orphan: true, delegation: { subject: null, chain: ["agent-a"], text: "agent-a" } })} onOpen={noop} />);
    expect(screen.getByTestId("orphan-badge")).toHaveTextContent(/ORPHAN/);
    expect(within(screen.getByTestId("chain")).getByText("no human recorded")).toBeInTheDocument();
    expect(screen.queryByText("no gaps found")).toBeNull();
  });
  it("shows gaps instead of hiding them", () => {
    render(<WhoPanel join={joinFixture({ gaps: [{ hop: "token", id: "g", message: "no exchange before the call" }] })} onOpen={noop} />);
    expect(screen.getByTestId("gap-badge")).toHaveTextContent("1 gap");
    expect(screen.getByText("no exchange before the call")).toBeInTheDocument();
  });
  it("labels the session-inferred link and reveals hidden characters in the timeline", () => {
    render(<WhoPanel join={joinFixture()} onOpen={noop} />);
    expect(screen.getByText("session-inferred")).toBeInTheDocument();
    expect(screen.getByText("[U+200B]")).toHaveClass("chip-hidden");
    expect(screen.getAllByTestId("tl-item")).toHaveLength(2);
  });
  it("shows an empty state before any run", () => {
    render(<WhoPanel join={null} onOpen={noop} />);
    expect(screen.getByText(/press Run/i)).toBeInTheDocument();
  });
});

describe("raw event viewer", () => {
  it("labels token events MOCK-ISSUED and shows both the envelope and the raw record", () => {
    render(<RawEvent event={{ id: "ev-9", source: "token", type: "token.issued", decision: null, flags: [], traceparent: null, raw: { a: 1 } }} onJoin={noop} onClose={noop} />);
    expect(screen.getByText("MOCK-ISSUED")).toBeInTheDocument();
    expect(screen.getByText("no valid traceparent")).toBeInTheDocument();
    expect(screen.getAllByTestId("untrusted")).toHaveLength(2);
  });
  it("does not label a gateway event as a token", () => {
    render(<RawEvent event={{ id: "ev-9", source: "gateway", type: "gateway.decision", decision: null, flags: [], traceparent: "00-x", raw: { a: 1 } }} onJoin={noop} onClose={noop} />);
    expect(screen.queryByText("MOCK-ISSUED")).toBeNull();
  });
});

describe("diagram steps", () => {
  const sim = { scenarioTitle: "T", run: { eventIds: ["a", "b", "c"] }, join: joinFixture({ orphan: true }), query: { tool: "search_audit_activities", argLabel: "traceId=aaaa", count: 3, clamped: false }, verify: { ok: true, length: 9 } };
  const diagram = diagramFixture();
  it("builds one sentence per diagram step from the real numbers", () => {
    const s = describeSteps(sim);
    expect(s).toHaveLength(5);
    expect(s).toHaveLength(diagram.steps.length);
    expect(s[0]).toContain("3 raw records");
    expect(s[3]).toContain("returned 3 events");
    expect(s[4]).toMatch(/orphaned/);
    const ids = diagram.nodes.map((n) => n.id);
    expect(diagram.steps.every((st) => focusOf(diagram, st).nodes.every((n) => ids.includes(n)))).toBe(true);
  });
  it("says so when the tool clamped, and builds nothing without a run", () => {
    expect(describeSteps({ ...sim, query: { ...sim.query, clamped: true } })[3]).toMatch(/clamped/);
    expect(describeSteps(null)).toEqual([]);
  });
  it("has the five boxes and arrows between them only", () => {
    expect(diagram.nodes.map((b) => b.id)).toEqual(["sources", "normalizer", "store", "tools", "join"]);
    expect(diagram.edges.every((e) => diagram.nodes.some((b) => b.id === e.source) && diagram.nodes.some((b) => b.id === e.target))).toBe(true);
  });
});

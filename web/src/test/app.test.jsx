import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App.jsx";
import { setJsonView } from "../components/JsonPane.jsx";
import { diagramFixture, joinFixture } from "./fixtures.js";

const SCEN = { scenarios: [{ id: "normal-purchase", title: "Normal purchase", story: "S", lesson: "L" }, { id: "orphaned-event", title: "Orphaned", story: "S2", lesson: "L2" }] };
const EVENTS = { total: 1, count: 1, clamped: false, note: null, nextCursor: null, events: [{ id: "ev-1", recordedAt: "2026-10-21T12:00:00.000Z", source: "gateway", type: "gateway.decision", traceId: null, sessionId: null, subject: null, actor: null, tool: null, decision: null, summary: "an event", flags: [] }] };
const SUMMARY = { windowDays: 7, total: 1, traces: 0, orphaned: 1, bySource: { gateway: 1 }, byType: {} };
const calls = [];
function route(url, init) {
  calls.push([init?.method || "GET", url]);
  const body = (o, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => o });
  if (url === "/api/health") return body({ state: "ready" });
  if (url === "/api/info") return body({ mode: "mock", source: "mock", realAvailable: false, realReason: "Live mode is not available in this app: no live audit source (from the server).", modes: { mock: true, live: false }, liveRefusal: "Live mode is not available in this app: no live audit source (from the server).", banner: "SIMULATION, MOCK mode: from the server", retentionDays: 7, events: 5 });
  if (url.startsWith("/api/diagram")) return body({ names: ["audit-flow"], diagram: diagramFixture() });
  if (url === "/api/scenarios") return body(SCEN);
  if (url.endsWith("/run")) return body({ traceId: "a".repeat(32), focusEventId: "ev-1", eventIds: ["ev-1", "ev-2"] });
  if (url.startsWith("/api/events/summary")) return body(SUMMARY);
  if (url.startsWith("/api/events/ev-")) return body({ id: "ev-1", source: "gateway", type: "gateway.decision", flags: [], raw: { k: "v" } });
  if (url.startsWith("/api/events")) return body(EVENTS);
  if (url.startsWith("/api/join")) return body(joinFixture());
  if (url === "/api/chain/verify") return body({ ok: true, length: 5, headSeq: 5, headHash: "ab".repeat(32) });
  if (url.startsWith("/api/retention-demo")) return body({ retentionDays: 7, naiveUpstream: { windowDays: 30, count: 0, note: "silently empty" }, auditTool: { windowDays: 7, count: 5, clamped: true, note: "clamped to 7 days" }, storedBeyondRetention: 1 });
  if (url === "/api/reset") return body({ ok: true });
  if (url === "/api/chain/tamper-demo") return body({ kind: "edit", change: { seq: 3, field: "event.actor", from: "agent-a", to: "agent-forged" }, before: { ok: true, length: 5 }, after: { ok: false, length: 5, firstBadSeq: 3, reason: "hash mismatch" }, liveStoreVerify: { ok: true, length: 5 }, realStoreTouched: false });
  if (url === "/api/mode") return body({ source: "mock", realAvailable: false, realReason: "Live mode is not available in this app: no live audit source (from the server)." });
  if (url === "/mcp") return body({ jsonrpc: "2.0", id: 1, result: { tools: ["search_audit_activities", "get_audit_activity", "audit_summary"].map((name) => ({ name, description: "d. more" })) } });
  return body({ error: "nope" }, 404);
}
beforeEach(() => { calls.length = 0; setJsonView("form"); globalThis.fetch = vi.fn(route); });
afterEach(() => vi.restoreAllMocks());

describe("App", () => {
  it("shows the simulation banner, DEMO badge and mode header on every tab", async () => {
    render(<App />);
    await screen.findByText(/from the server/);
    expect(screen.getByTestId("mode-badge")).toHaveTextContent("DEMO");
    expect(screen.getByTestId("mode-header")).toHaveTextContent("mock");
    const nav = screen.getByRole("navigation", { name: "Views" });
    for (const name of ["Story", "Events", "Retention", "Tools", "Integrity", "Diagram"]) {
      await userEvent.click(within(nav).getByRole("link", { name }));
      expect(within(nav).getByRole("link", { name })).toHaveAttribute("aria-current", "page"); // shell-nav pill marks the current view
      expect(screen.getByTestId("sim-banner")).toHaveTextContent(/SIMULATION/);
      expect(document.querySelector("main").firstElementChild).toBe(screen.getByTestId("sim-banner")); // shell bar first, then main with the banner first
    }
    expect(nav.closest("header.shell-bar")).not.toBeNull();
    expect(within(nav).getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page")).toHaveLength(1);
  });
  it("one primary button per view: Run on Story and Retention, the view's own action elsewhere (Run is plain there)", async () => {
    render(<App />);
    await screen.findByText(/from the server/);
    const nav = screen.getByRole("navigation", { name: "Views" });
    const expected = { Story: "Run", Events: "Search", Retention: "Run", Tools: "Call tool", Integrity: "Verify chain", Diagram: "Simulate" };
    for (const [view, action] of Object.entries(expected)) {
      await userEvent.click(within(nav).getByRole("link", { name: view }));
      const btn = await screen.findByRole("button", { name: action });
      const primaries = document.querySelectorAll("button.primary");
      expect(primaries, view).toHaveLength(1);
      expect(primaries[0], view).toBe(btn);
      if (action !== "Run") expect(screen.getByRole("button", { name: "Run" }), view).not.toHaveClass("primary");
    }
  });
  it("sends a per-tab workspace id on every request and the banner is a labelled landmark", async () => {
    render(<App />);
    await screen.findByText(/from the server/);
    const ids = new Set(globalThis.fetch.mock.calls.map(([, init]) => init?.headers?.["X-Workspace-Id"]));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toMatch(/^ws-[0-9a-f]{16}$|^default$/);
    expect(screen.getByRole("region", { name: "Simulation notice" })).toBe(screen.getByTestId("sim-banner"));
  });
  it("customer branding changes the heading", async () => {
    globalThis.fetch = vi.fn((url, init) => (url === "/api/info" ? Promise.resolve({ ok: true, status: 200, json: async () => ({ mode: "mock", banner: "SIMULATION, MOCK mode: shared", retentionDays: 7, events: 1, customer: { brand: { title: "Acme Audit" } } }) }) : route(url, init)));
    render(<App />);
    await screen.findByText(/shared/);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Acme Audit");
  });
  it("has a Mock | Real toggle in the header on every tab; Real is disabled because this lab is mock only", async () => {
    render(<App />);
    await screen.findByText(/from the server/);
    const nav = screen.getByRole("navigation", { name: "Views" });
    for (const name of ["Story", "Events", "Retention", "Tools", "Integrity", "Diagram"]) {
      await userEvent.click(within(nav).getByRole("link", { name }));
      const mode = screen.getByTestId("mode-select");
      expect(mode).toHaveValue("mock");
    }
    expect(screen.getByTestId("live-note")).not.toBeVisible();
    // Rule 19: Real is disabled with the server's reason; switching is impossible and the page stays mock.
    const realOption = screen.getByTestId("mode-select").querySelector('option[value="real"]');
    expect(realOption).toBeDisabled();
    expect(screen.getByTestId("mode-select")).toHaveAccessibleDescription("");
    expect(screen.getByTestId("mode-header")).toHaveTextContent("mock");
    expect(screen.getByTestId("sim-banner")).toHaveTextContent(/MOCK mode/);
    expect(screen.getByTestId("sim-banner")).toHaveAttribute("data-state", "mock");
  });
  it("rule 19: a successful mode switch posts /api/mode and reloads the data", async () => {
    globalThis.fetch = vi.fn((url, init) => {
      if (url === "/api/mode" && init?.method === "POST") {
        expect(JSON.parse(init.body)).toEqual({ source: "real" });
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ source: "real", realAvailable: true }) });
      }
      if (url === "/api/info") return Promise.resolve({ ok: true, status: 200, json: async () => ({ mode: "real", source: "real", realAvailable: true, banner: "SIMULATION, REAL mode: live tenant", retentionDays: 7, events: 5 }) });
      return route(url, init);
    });
    render(<App />);
    await screen.findByText(/live tenant/);
    await userEvent.selectOptions(screen.getByTestId("mode-select"), "real");
    await waitFor(() => expect(screen.getByTestId("mode-header")).toHaveTextContent("real"));
    // data reloaded after the switch (the select reflects the server's answer)
    expect(screen.getByTestId("mode-select")).toHaveValue("real");
  });
  it("rule 19: a refused switch shows the server's 409 reason and the page stays mock", async () => {
    globalThis.fetch = vi.fn((url, init) => (url === "/api/mode" && init?.method === "POST"
      ? Promise.resolve({ ok: false, status: 409, json: async () => ({ error: "real_not_available", source: "mock", realAvailable: false, realReason: "This lab is mock only.", message: "This lab is mock only." }) })
      : url === "/api/info"
        ? Promise.resolve({ ok: true, status: 200, json: async () => ({ mode: "mock", source: "mock", realAvailable: true, banner: "SIMULATION, MOCK mode: from the server", retentionDays: 7, events: 5 }) })
        : route(url, init)));
    render(<App />);
    await screen.findByText(/from the server/);
    await userEvent.selectOptions(screen.getByTestId("mode-select"), "real");
    await waitFor(() => expect(globalThis.fetch.mock.calls.some(([u, i]) => u === "/api/mode" && i?.method === "POST")).toBe(true));
    expect(screen.getByTestId("mode-header")).toHaveTextContent("mock");
    expect(screen.getByTestId("sim-banner")).toHaveAttribute("data-state", "mock");
  });
  it("still keeps Real unavailable when the server cannot be asked", async () => {
    globalThis.fetch = vi.fn((url, init) => (url === "/api/info" ? Promise.reject(new Error("down")) : route(url, init)));
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("mode-select")).toBeInTheDocument());
    expect(screen.getByTestId("mode-select").querySelector('option[value="real"]')).toBeDisabled();
    expect(screen.getByTestId("sim-banner")).toHaveTextContent(/SIMULATION, MOCK mode|MOCK mode/);
  });
  it("keeps the banner in presenter mode", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Presenter mode (P)" }));
    expect(screen.getByTestId("app")).toHaveClass("app--presenter");
    expect(screen.getByTestId("sim-banner")).toBeVisible();
    expect(screen.getByTestId("mode-header")).toBeVisible();
    await userEvent.click(screen.getByTestId("presenter"));
    expect(screen.getByTestId("app")).not.toHaveClass("app--presenter");
  });
  it("P toggles presenter mode and Escape leaves it; the banner stays; modifier keys, held keys and typing are ignored", async () => {
    render(<App />);
    await screen.findByText(/from the server/);
    const app = screen.getByTestId("app");
    await userEvent.keyboard("p");
    expect(app).toHaveClass("app--presenter");
    expect(screen.getByTestId("sim-banner")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    expect(app).not.toHaveClass("app--presenter");
    await userEvent.keyboard("P");
    expect(app).toHaveClass("app--presenter");
    await userEvent.keyboard("P");
    expect(app).not.toHaveClass("app--presenter");
    for (const mod of ["Control", "Meta", "Alt"]) {
      await userEvent.keyboard(`{${mod}>}p{/${mod}}`);
      expect(app).not.toHaveClass("app--presenter");
    }
    fireEvent.keyDown(window, { key: "p", repeat: true });
    expect(app).not.toHaveClass("app--presenter");
    await userEvent.click(screen.getByRole("link", { name: "Events" }));
    const field = await screen.findByLabelText("Tool");
    // One key at a time: "pP" in one go would toggle twice and end off even without the typing guard.
    await userEvent.type(field, "p");
    expect(app).not.toHaveClass("app--presenter");
    await userEvent.type(field, "P");
    expect(app).not.toHaveClass("app--presenter");
    expect(field).toHaveValue("pP");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(app).not.toHaveClass("app--presenter");
  });
  it("Run uses aria-disabled while it works, so keyboard focus stays on the button", async () => {
    let release;
    globalThis.fetch = vi.fn((url, init) => (url.endsWith("/run") ? new Promise((r) => { release = () => r(route(url, init)); }) : route(url, init)));
    render(<App />);
    await screen.findByRole("option", { name: "Normal purchase" });
    const run = screen.getByRole("button", { name: "Run" });
    expect(run).not.toHaveAttribute("aria-disabled");
    run.focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(run).toHaveAttribute("aria-disabled", "true"));
    expect(run).not.toBeDisabled();
    expect(document.activeElement).toBe(run);
    await userEvent.keyboard("{Enter}");
    expect(globalThis.fetch.mock.calls.filter(([u]) => u.endsWith("/run")).length).toBe(1);
    release();
    await screen.findByTestId("sentence");
    expect(run).not.toHaveAttribute("aria-disabled");
    expect(document.activeElement).toBe(run);
  });
  it("Run runs the scenario, queries the audit tool by trace id, then joins", async () => {
    render(<App />);
    await screen.findByRole("option", { name: "Normal purchase" });
    await userEvent.click(screen.getByRole("button", { name: "Run" }));
    await screen.findByTestId("sentence");
    const seq = calls.map(([m, u]) => `${m} ${u.split("?")[0]}`);
    expect(seq).toContain("POST /api/scenarios/normal-purchase/run");
    expect(calls.some(([, u]) => u.startsWith("/api/events?") && u.includes(`traceId=${"a".repeat(32)}`))).toBe(true);
    expect(calls.some(([, u]) => u.startsWith(`/api/join?traceId=`))).toBe(true);
    expect(screen.getByTestId("run-status")).toHaveTextContent(/2 events joined/);
  });
  it("sends no credentials and no custom auth header on any request", async () => {
    render(<App />);
    await screen.findByRole("option", { name: "Normal purchase" });
    await userEvent.click(screen.getByRole("button", { name: "Run" }));
    await screen.findByTestId("sentence");
    for (const [, init] of globalThis.fetch.mock.calls) {
      expect(init.credentials).toBe("omit");
      expect(Object.keys(init.headers).map((h) => h.toLowerCase())).not.toContain("authorization");
    }
  });
  it("search: sends only the filters set, and shows the server's clamp note", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("link", { name: "Events" }));
    await screen.findByText("an event");
    fireEvent.change(screen.getByLabelText("Tool"), { target: { value: "purchase.create" } });
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(calls.some(([, u]) => u.startsWith("/api/events?") && u.includes("tool=purchase.create"))).toBe(true));
    const q = calls.filter(([, u]) => u.startsWith("/api/events?")).pop()[1];
    expect(q).not.toContain("source="); // empty filters are not sent
  });
  it("opens the raw viewer from a result row", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("link", { name: "Events" }));
    await userEvent.click(await screen.findByRole("button", { name: /Open raw event ev-1/ }));
    expect(await screen.findByTestId("raw-event")).toBeInTheDocument();
  });
  it("retention tab shows the naive zero next to the clamped answer", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("link", { name: "Retention" }));
    expect(await screen.findByTestId("naive")).toHaveTextContent("0 events");
    expect(screen.getByTestId("tool-answer")).toHaveTextContent("clamped to 7 days");
    expect(screen.getByRole("heading", { name: /Retention window/ })).toHaveTextContent("UNVERIFIED");
  });
  it("tools tab lists exactly what the endpoint advertises and states the read-only lesson", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("link", { name: "Tools" }));
    expect(await screen.findByText("3 tools advertised")).toBeInTheDocument();
    expect(screen.getByTestId("readonly-lesson")).toHaveTextContent(/exposes exactly what is implemented/);
  });
  it("tools tab shows the JSON-RPC request and response through the shared JsonPane", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("link", { name: "Tools" }));
    await screen.findByText("3 tools advertised");
    await userEvent.click(screen.getByRole("button", { name: "Call tool" }));
    const result = await screen.findByTestId("rpc-result");
    expect(within(result).getByTestId("rpc-request")).toHaveTextContent("tools/call");
    expect(within(result).getByTestId("rpc-response")).toBeInTheDocument();
    await userEvent.click(within(result).getAllByRole("button", { name: "JSON" })[0]);
    expect(within(result).getByTestId("rpc-request").tagName).toBe("PRE");
    expect(within(result).getByTestId("rpc-request").textContent).toContain('"jsonrpc": "2.0"');
  });
  it("integrity tab shows the tamper change through the shared JsonPane", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("link", { name: "Integrity" }));
    await userEvent.click(screen.getByRole("button", { name: "Tamper with a copy" }));
    const change = await screen.findByTestId("tamper-change");
    expect(change).toHaveTextContent("agent-forged");
    await userEvent.click(within(screen.getByTestId("tamper-out")).getByRole("button", { name: "JSON" }));
    expect(screen.getByTestId("tamper-change").tagName).toBe("PRE");
    expect(screen.getByTestId("tamper-change").textContent).toBe(JSON.stringify({ seq: 3, field: "event.actor", from: "agent-a", to: "agent-forged" }, null, 2));
  });
  it("header Reset posts a reset and clears the story", async () => {
    render(<App />);
    await screen.findByRole("option", { name: "Normal purchase" });
    await userEvent.click(screen.getByRole("button", { name: "Run" }));
    await screen.findByTestId("sentence");
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(screen.queryByTestId("sentence")).toBeNull());
    expect(calls).toContainEqual(["POST", "/api/reset"]);
  });
});

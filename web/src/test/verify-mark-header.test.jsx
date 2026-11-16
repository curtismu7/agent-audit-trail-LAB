import React from "react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App.jsx";
import { diagramFixture, joinFixture } from "./fixtures.js";

// The header shows this lab's own Verified / In progress mark, read from the same /api/shelf call the Shelf link makes (through the lab-proxy
// that call reaches the shelf, whose payload lists every demo with its mark). The lab's own /api/shelf has no demos, so there is no mark then.
const mark = (status, label, extra = {}) => ({ status, label, note: "", updatedAt: "2026-11-15", source: "shipped", ...extra });
const shelfRequests = [];
function stub(shelf) {
  globalThis.fetch = vi.fn((url, init) => {
    const body = (o, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => o });
    if (url === "/api/shelf") { shelfRequests.push(init); return body(shelf); }
    if (url === "/api/health") return body({ state: "ready" });
    if (url === "/api/chain/verify") return body({ ok: true, length: 5, headSeq: 5, headHash: "ab".repeat(32) });
    if (url === "/api/info") return body({ mode: "mock", source: "mock", realAvailable: false, realReason: "mock only", modes: { mock: true, live: false }, banner: "SIMULATION, MOCK mode: from the server", retentionDays: 7, events: 5 });
    if (url.startsWith("/api/diagram")) return body({ names: ["audit-flow"], diagram: diagramFixture() });
    if (url === "/api/scenarios") return body({ scenarios: [{ id: "normal-purchase", title: "Normal purchase", story: "S", lesson: "L" }] });
    if (url.startsWith("/api/events/summary")) return body({ windowDays: 7, total: 0, traces: 0, orphaned: 0, bySource: {}, byType: {} });
    if (url.startsWith("/api/events")) return body({ total: 0, count: 0, clamped: false, note: null, nextCursor: null, events: [] });
    if (url.startsWith("/api/join")) return body(joinFixture());
    return body({ error: "nope" }, 404);
  });
}
beforeEach(() => { shelfRequests.length = 0; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("verification mark in the header", () => {
  it("shows this lab's own mark beside the Shelf link, and no other lab's", async () => {
    stub({ shelfUrl: "http://shelf.example", demos: [{ id: "other-lab", verification: mark("in-progress", "In progress") }, { id: "agent-audit-trail-lab", verification: mark("verified", "Verified", { note: "Every scenario run on the mock" }) }] });
    render(<App />);
    const bar = within(await screen.findByTestId("top-menu"));
    expect(await bar.findByText("Verified")).toBeInTheDocument();
    expect(bar.getByRole("link", { name: "Shelf" })).toBeInTheDocument();
    expect(bar.queryByText("In progress")).toBeNull();
    expect(document.querySelectorAll(".verify")).toHaveLength(1);
    expect(bar.getByText("Verified").closest(".verify")).toHaveAttribute("title", expect.stringContaining("Every scenario run on the mock"));
    // it sends the same X-Workspace-Id the Shelf link and the api helper send
    expect(shelfRequests.length).toBeGreaterThanOrEqual(2);
    for (const init of shelfRequests) expect(init.headers["X-Workspace-Id"]).toBeTruthy();
  });

  it("shows nothing on the lab's own port (no demos), with no mark, or with a none mark", async () => {
    for (const payload of [{ shelfUrl: "http://shelf.example" }, { shelfUrl: "http://shelf.example", demos: [{ id: "agent-audit-trail-lab", verification: null }] }, { shelfUrl: "http://shelf.example", demos: [{ id: "agent-audit-trail-lab", verification: mark("none", "None") }] }]) {
      stub(payload);
      const { unmount } = render(<App />);
      const bar = within(await screen.findByTestId("top-menu"));
      expect(await bar.findByRole("link", { name: "Shelf" })).toBeInTheDocument(); // the shelf answered, and still no badge
      expect(document.querySelector(".verify")).toBeNull();
      unmount();
    }
  });
});

// The vendored VerifyMark.css styles the generic `.verify` class for the header badge. The lab's own audit chain status line must not share it
// (it did: the lab's border, padding and bold restyled the badge, and the badge's flex rules restyled the status line).
describe("the badge's .verify class is not shared with the lab's audit status line", () => {
  it("on screen together, the badge is the only .verify and the audit line is .audit-verify", async () => {
    stub({ shelfUrl: "http://shelf.example", demos: [{ id: "agent-audit-trail-lab", verification: mark("verified", "Verified") }] });
    render(<App />);
    const bar = within(await screen.findByTestId("top-menu"));
    expect(await bar.findByText("Verified")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Integrity" }));
    await userEvent.click(screen.getByRole("button", { name: "Verify chain" }));
    const verdict = await screen.findByTestId("verdict-live store");
    expect(verdict).toHaveClass("audit-verify", "audit-verify--ok");
    expect(verdict).not.toHaveClass("verify");
    const verifies = document.querySelectorAll(".verify");
    expect(verifies).toHaveLength(1);
    expect(verifies[0]).toBe(bar.getByText("Verified").closest(".verify"));
  });

  it("app.css and IntegrityTab.jsx define and use no bare verify class (verify-slot is a different class and stays)", () => {
    const src = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
    const css = fs.readFileSync(path.join(src, "app.css"), "utf8");
    expect(css).not.toMatch(/\.verify(?![\w-])/);
    expect(css).not.toMatch(/\.verify(--|__)/);
    expect(fs.readFileSync(path.join(src, "components", "IntegrityTab.jsx"), "utf8")).not.toMatch(/["'`\s]verify(--[\w-]+)?[\s"'`$]/);
  });
});

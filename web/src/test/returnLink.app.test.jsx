// Opened from Customer Agent LAB: the strip and the header Back button show; nothing is preselected.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { returnLinkFor } from "../return-link/returnTargets.js";
import App from "../App.jsx";
import { diagramFixture, joinFixture } from "./fixtures.js";

// The same fetch stub shape as app.test.jsx: this app's api module calls fetch, so the tests stub fetch.
function route(url) {
  const body = (o, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => o });
  if (url === "/api/health") return body({ state: "ready" });
  if (url === "/api/info") return body({ mode: "mock", source: "mock", realAvailable: false, realReason: "mock only", modes: { mock: true, live: false }, banner: "SIMULATION, MOCK mode: from the server", retentionDays: 7, events: 5 });
  if (url.startsWith("/api/diagram")) return body({ names: ["audit-flow"], diagram: diagramFixture() });
  if (url === "/api/scenarios") return body({ scenarios: [{ id: "normal-purchase", title: "Normal purchase", story: "S", lesson: "L" }] });
  if (url.startsWith("/api/events/summary")) return body({ windowDays: 7, total: 0, traces: 0, orphaned: 0, bySource: {}, byType: {} });
  if (url.startsWith("/api/events")) return body({ total: 0, count: 0, clamped: false, note: null, nextCursor: null, events: [] });
  if (url.startsWith("/api/join")) return body(joinFixture());
  return body({ error: "nope" }, 404);
}
beforeEach(() => { globalThis.fetch = vi.fn(route); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, "", "/"); });

const NOTE = { name: "Opened from Customer Agent LAB" };

describe("return link", () => {
  it("the vendored files match return-link.sha256, which names the parent commit", () => {
    const dir = path.join(process.cwd(), "src", "return-link");
    const text = fs.readFileSync(path.join(dir, "return-link.sha256"), "utf8");
    expect(text.split("\n")[0]).toMatch(/^# vendored byte for byte from curtismu7\/AI-DEMO-Standalone shared\/return-link at [0-9a-f]{7,40}/);
    const pins = text.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(/\s+/));
    expect(pins.map(([, f]) => f).sort()).toEqual(["ReturnLink.jsx", "ReturnLink.test.jsx", "returnTargets.js"]);
    for (const [h, f] of pins) expect(createHash("sha256").update(fs.readFileSync(path.join(dir, f))).digest("hex"), f).toBe(h);
  });

  it("?from=customer-agent: banner first, strip right below, header Back in the tools", async () => {
    window.history.replaceState(null, "", "/?from=customer-agent&uc=UC20&vertical=banking");
    render(<App />);
    const note = await screen.findByRole("note", NOTE);
    expect(note.textContent).toContain("UC20");
    expect(screen.getByTestId("sim-banner").nextElementSibling).toBe(note);
    expect(document.querySelector(".tools-right > button.return-link--header")).not.toBeNull();
    expect(screen.getAllByRole("button", { name: /Back to Customer Agent LAB/ })).toHaveLength(2);
  });

  it("no from, an unknown from or a bad id: no strip, no button", async () => {
    for (const q of ["/", "/?from=elsewhere&uc=UC20", "/?from=customer-agent&uc=%3Cb%3E", "/?from=customer-agent&uc=UC20&vertical=a%20b"]) {
      window.history.replaceState(null, "", q);
      render(<App />);
      await screen.findByText(/from the server/);
      expect(screen.queryByRole("button", { name: /Back to/ })).toBeNull();
      expect(screen.queryByRole("note", NOTE)).toBeNull();
      cleanup();
    }
  });

  it("Back goes to the proxy path behind the lab proxy, to the direct URL on the app's own port", () => {
    window.history.replaceState(null, "", "/agent-audit-trail-lab/?from=customer-agent&uc=UC20");
    expect(returnLinkFor("agent-audit-trail").href).toBe("/customer-agent/?returned=agent-audit-trail&uc=UC20");
    window.history.replaceState(null, "", "/?from=customer-agent&uc=UC20");
    expect(returnLinkFor("agent-audit-trail").href).toBe("http://127.0.0.1:5603/?returned=agent-audit-trail&uc=UC20");
  });
});

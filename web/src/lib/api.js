// Thin fetch wrapper. Same origin only. No credentials, no cookies, no auth headers: the server refuses them.
// A POST body is JSON, the only body type the server accepts.
//
// X-Workspace-Id (not a credential, just a label) gives each browser tab its own in-memory workspace, so on a shared
// shared machine one visitor's Reset never touches another's. It lives in sessionStorage; without storage the tab uses "default".
export function workspaceId() {
  try {
    let id = sessionStorage.getItem("aat-workspace");
    if (!id || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(id)) {
      id = `ws-${Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("")}`;
      sessionStorage.setItem("aat-workspace", id);
    }
    return id;
  } catch { return "default"; }
}

async function call(path, method = "GET", body) {
  const init = { method, headers: { Accept: "application/json", "X-Workspace-Id": workspaceId() }, credentials: "omit" };
  if (body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
  const res = await fetch(path, init);
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const err = new Error(data?.message || data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = data?.error;
    throw err;
  }
  return data;
}

export const getHealth = () => call("/api/health");
export const getInfo = () => call("/api/info");
export const getScenarios = () => call("/api/scenarios");
export const getDiagram = (name) => call(`/api/diagram${name ? `?name=${encodeURIComponent(name)}` : ""}`);
export const runScenario = (id) => call(`/api/scenarios/${encodeURIComponent(id)}/run`, "POST");
export const getTools = () => call("/api/tools");
export const getSummary = (days) => call(`/api/events/summary${days ? `?days=${days}` : ""}`);
export const getEvent = (id) => call(`/api/events/${encodeURIComponent(id)}`);
export const getJoin = (q) => call(`/api/join?${q.traceId ? `traceId=${encodeURIComponent(q.traceId)}` : `eventId=${encodeURIComponent(q.eventId)}`}`);
export const getRetentionDemo = (days) => call(`/api/retention-demo?days=${days}`);
export const verifyChain = () => call("/api/chain/verify");
export const tamperDemo = (kind) => call("/api/chain/tamper-demo", "POST", { kind });
export const postReset = (vertical) => call("/api/reset", "POST", vertical ? { vertical } : undefined);

const FILTER_KEYS = ["days", "limit", "cursor", "eventType", "source", "traceId", "sessionId", "actor", "subject", "tool", "decision", "orphaned"];
// Only non-empty, known filters are sent. The server validates every one again.
export function searchEvents(filters) {
  const q = new URLSearchParams();
  for (const k of FILTER_KEYS) { const v = filters[k]; if (v !== undefined && v !== "" && v !== null) q.set(k, String(v)); }
  return call(`/api/events?${q}`);
}

// The MCP-style endpoint: JSON-RPC 2.0 over POST. The UI shows the request and the response exactly as sent.
let rpcId = 0;
export async function rpc(method, params) {
  const request = { jsonrpc: "2.0", id: ++rpcId, method, ...(params ? { params } : {}) };
  const response = await call("/mcp", "POST", request);
  return { request, response };
}

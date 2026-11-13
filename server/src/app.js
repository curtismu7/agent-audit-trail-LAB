// One Express app: the API under /api and the MCP-style endpoint at /mcp. createApp() is what the tests use.
// Every event string was made inert when it was normalized, and is served as JSON only.
//
// What is read-only and what is not: the AUDIT TOOLS (REST /api/events*, /api/join, and MCP /mcp) can only read.
// The demo CONTROLS (POST /api/scenarios/:id/run, /api/reset, /api/chain/tamper-demo) exist so a presenter can
// make the audience see something happen; they are not part of the audit tool surface and are not offered as tools.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TAMPER_KINDS } from './chain.js';
import { createHealth } from './health.js';
import { allPassed, runChecks as defaultChecks } from './doctor.js';
import { createMcpRouter } from './mcp.js';
import { VERTICALS, createRuntime } from './runtime.js';
import { DEFAULT_WORKSPACE, WORKSPACE_RE, createWorkspaces } from './workspaces.js';
import { LIVE_REFUSAL, loadCustomer, modeFrom, normalizeCustomer } from './config.js';
import { DIAGRAM_NAMES, hasDiagram, rawDiagram } from './diagramData.js';
import { assertBindAllowed, bindHost, credentialGuard, makeHostGuard, makeOriginGuard, parseAllowedHosts, serverPort } from './safety.js';
import { getScenario } from './scenarios.js';
import { MAX_LIMIT, RETENTION_DAYS, UNVERIFIED } from './store.js';
import { ToolError, TOOLS } from './tools.js';
import { shelfInfo } from './shelfLink.js';

const APP_VERSION = (() => { try { return JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version || null; } catch { return null; } })();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, message, status = 400) => res.status(status).json({ error: status === 404 ? 'not_found' : 'bad_request', message });
export const DEFAULT_WEB_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
const API_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'", 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
// The built UI (step AT1): same-origin scripts, styles, images and fetches only.
export const UI_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const ID_RE = /^[a-z0-9-]{1,40}$/;
const methods = (allow) => (_req, res) => res.set('Allow', allow).status(405).json({ error: 'method_not_allowed' });
const onlyKeys = (body, allowed) => !body || Object.keys(body).every((k) => allowed.includes(k));
const INT_KEYS = new Set(['days', 'limit']);

// Query string -> tool arguments. Parsed from the raw URL (not req.query) so that EVERY key is seen, including
// __proto__ and constructor: unknown keys then fail the tool's own validation as a 400. Repeated keys are refused.
function queryArgs(req) {
  const out = Object.create(null);
  const raw = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?') + 1) : '';
  for (const [k, v] of new URLSearchParams(raw)) {
    if (k in out) throw new ToolError(`${k.slice(0, 40)} must appear once`);
    if (INT_KEYS.has(k)) { if (!/^\d{1,10}$/.test(v)) throw new ToolError(`${k} must be a positive integer`); out[k] = Number(v); }
    else if (k === 'orphaned') { if (v !== 'true' && v !== 'false') throw new ToolError('orphaned must be true or false'); out[k] = v === 'true'; }
    else out[k] = v;
  }
  return out;
}
const toolStatus = (e) => (e.code === 'not_found' ? 404 : e.code === 'unknown_tool' ? 404 : 400);

export function createApp({ runtime, health = createHealth({ demoId: 'agent-audit-trail-lab', demoName: 'Agent Audit Trail LAB', version: '0.1.0', runChecks: (a) => defaultChecks(a), allPassed }), webDist = null, customer = normalizeCustomer(null), createWorkspaceRuntime = () => createRuntime(), allowedHosts = parseAllowedHosts(), port = serverPort() } = {}) {
  const workspaces = createWorkspaces({ defaultRuntime: runtime, create: createWorkspaceRuntime });
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.use(makeHostGuard({ allowed: allowedHosts, port }));
  app.use(credentialGuard); // every route, static files included
  app.use(makeOriginGuard({ allowed: allowedHosts, port }));
  app.use((_req, res, next) => { res.set(API_HEADERS); next(); });
  // The workspace this request works in. Static files do not need one, so the lookup is lazy for them.
  app.use((req, res, next) => {
    const id = req.headers['x-workspace-id'];
    if (id !== undefined && (typeof id !== 'string' || !WORKSPACE_RE.test(id))) return bad(res, 'X-Workspace-Id must be 1-32 characters of a-z, 0-9 and hyphen');
    req.workspaceId = id ?? DEFAULT_WORKSPACE;
    Object.defineProperty(req, 'rt', { get: () => workspaces.get(req.workspaceId), configurable: true });
    return next();
  });
  if (webDist && fs.existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist, {
      index: 'index.html', dotfiles: 'ignore',
      setHeaders: (res) => res.set({ ...API_HEADERS, 'Content-Security-Policy': UI_CSP }),
    }));
  }

  // The MCP-style endpoint resolves the tools lazily so a Reset (which rebuilds the store) is always honoured.
  app.use('/mcp', createMcpRouter({ toolsFor: (req) => req.rt.tools }));

  const api = express.Router();
  api.use('/health', health.router);
  api.use(express.json({ limit: '2kb' }));

  api.route('/info').get((req, res) => res.json({
    mode: req.rt.mode, modes: { mock: true, live: false }, liveRefusal: LIVE_REFUSAL, simulated: true, workspace: req.workspaceId, customer,
    // Rule 19: what the Mock/Real toggle needs. This lab is mock only, so Real is never available.
    source: 'mock', realAvailable: false, realReason: LIVE_REFUSAL,
    vertical: req.rt.vertical, verticals: VERTICALS,
    banner: 'SIMULATION, MOCK mode: every event here is synthetic and seeded. No tenant, no network, no credentials. Tokens shown are mock-issued claims.',
    retentionDays: RETENTION_DAYS, retentionProvenance: UNVERIFIED, maxLimit: MAX_LIMIT,
    events: req.rt.store.size, epoch: req.rt.epoch, tamperKinds: TAMPER_KINDS,
    version: APP_VERSION,
  })).all(methods('GET'));

  // Rule 19: runtime mode is server-side. This lab is mock only, so mock→real is refused 409 and real→mock is a no-op.
  api.route('/mode').post((req, res) => {
    const next = req.body?.source;
    if (next !== 'mock' && next !== 'real') return bad(res, 'source must be exactly "mock" or "real"');
    if (next === 'real') return res.status(409).json({ error: 'real_not_available', source: 'mock', realAvailable: false, realReason: LIVE_REFUSAL, message: LIVE_REFUSAL });
    return res.json({ source: 'mock', realAvailable: false, realReason: LIVE_REFUSAL, message: 'This lab is mock only; the page stays in mock mode.' });
  }).all(methods('POST'));

  // Diagrams are diagram-studio/1 data, loaded by name (rule 17).
  api.route('/diagram').get((req, res) => {
    const keys = Object.keys(req.query);
    if (keys.some((k) => k !== 'name') || (req.query.name !== undefined && typeof req.query.name !== 'string')) return bad(res, 'pass only an optional name');
    const name = req.query.name ?? DIAGRAM_NAMES[0];
    if (!hasDiagram(name)) return bad(res, 'no such diagram', 404);
    return res.json({ mode: req.rt.mode, names: DIAGRAM_NAMES, diagram: rawDiagram(name) });
  }).all(methods('GET'));

  api.route('/scenarios').get((req, res) => res.json({ mode: req.rt.mode, scenarios: req.rt.scenarios(), seeded: req.rt.seeded })).all(methods('GET'));
  api.route('/scenarios/:id/run').post((req, res) => {
    if (!ID_RE.test(req.params.id) || !getScenario(req.params.id)) return bad(res, 'no such scenario', 404);
    if (req.body && Object.keys(req.body).length) return bad(res, 'running a scenario takes no parameters');
    try { return res.json({ mode: req.rt.mode, ...req.rt.runScenario(req.params.id) }); } catch (e) {
      if (e?.code === 'store_full') return res.status(409).json({ error: 'store_full', message: e.message });
      throw e;
    }
  }).all(methods('POST'));

  api.route('/tools').get((req, res) => res.json({
    mode: req.rt.mode, readOnly: true, tools: TOOLS,
    lesson: 'The audit surface exposes exactly what is implemented: three read-only tools. There is no write, delete or reset tool to find.',
  })).all(methods('GET'));

  const toolRoute = (name, argsOf) => (req, res) => {
    try { res.json({ mode: req.rt.mode, ...req.rt.tools.call(name, argsOf(req)) }); } catch (e) {
      if (e instanceof ToolError) return res.status(toolStatus(e)).json({ error: e.code, message: e.message });
      throw e;
    }
  };
  api.route('/events').get(toolRoute('search_audit_activities', queryArgs)).all(methods('GET'));
  api.route('/events/summary').get(toolRoute('audit_summary', queryArgs)).all(methods('GET'));
  api.route('/events/:id').get(toolRoute('get_audit_activity', (req) => ({ activityId: req.params.id }))).all(methods('GET'));

  api.route('/join').get((req, res) => {
    const keys = Object.keys(req.query);
    if (keys.length !== 1 || !['traceId', 'eventId'].includes(keys[0]) || typeof req.query[keys[0]] !== 'string') return bad(res, 'pass exactly one of traceId or eventId');
    const r = keys[0] === 'traceId' ? req.rt.join.byTrace(req.query.traceId) : req.rt.join.byEvent(req.query.eventId);
    if (!r.found) return res.status(r.reason?.startsWith('bad_') ? 400 : 404).json({ error: r.reason === 'bad_trace_id' ? 'bad_request' : 'not_found', message: r.reason === 'bad_trace_id' ? 'traceId must be 32 lowercase hex characters' : 'no such trace or event in the retained window' });
    return res.json({ mode: req.rt.mode, ...r });
  }).all(methods('GET'));

  api.route('/retention-demo').get((req, res) => {
    const d = req.query.days === undefined ? '30' : req.query.days;
    if (typeof d !== 'string' || !/^\d{1,3}$/.test(d) || Number(d) < 1 || Number(d) > 365) return bad(res, 'days must be an integer 1-365');
    return res.json({ mode: req.rt.mode, ...req.rt.store.retentionDemo(Number(d)) });
  }).all(methods('GET'));

  api.route('/chain/verify').get((req, res) => res.json({ mode: req.rt.mode, ...req.rt.store.chain.verify(), epoch: req.rt.epoch })).all(methods('GET'));
  api.route('/chain').get((req, res) => {
    const after = req.query.after === undefined ? 0 : (/^\d{1,9}$/.test(req.query.after) ? Number(req.query.after) : null);
    const limit = req.query.limit === undefined ? 100 : (/^\d{1,4}$/.test(req.query.limit) ? Number(req.query.limit) : null);
    if (after === null || limit === null || limit < 1 || limit > 500) return bad(res, 'after and limit must be small integers (limit 1-500)');
    const rows = req.rt.store.chain.list().filter((e) => e.seq > after).slice(0, limit).map((e) => ({ seq: e.seq, at: e.at, eventId: e.event.id, type: e.event.type, prevHash: e.prevHash, hash: e.hash }));
    return res.json({ mode: req.rt.mode, entries: rows, head: req.rt.store.chain.head, size: req.rt.store.chain.size });
  }).all(methods('GET'));
  api.route('/chain/tamper-demo').post((req, res) => {
    const b = req.body ?? {};
    if (!onlyKeys(b, ['kind', 'seq']) || (b.kind !== undefined && !TAMPER_KINDS.includes(b.kind)) || (b.seq !== undefined && (!Number.isInteger(b.seq) || b.seq < 1 || b.seq > 100000))) {
      return bad(res, `body may hold kind (${TAMPER_KINDS.join(', ')}) and seq (a positive integer)`);
    }
    const r = req.rt.store.chain.tamperDemo(b.kind, b.seq);
    if (r.error) return bad(res, r.error);
    return res.json({ mode: req.rt.mode, ...r, liveStoreVerify: req.rt.store.chain.verify() });
  }).all(methods('POST'));

  api.route('/reset').post((req, res) => {
    const b = req.body ?? {};
    if (!onlyKeys(b, ['vertical']) || (b.vertical !== undefined && !VERTICALS.includes(b.vertical))) return bad(res, `POST /api/reset takes only an optional vertical (${VERTICALS.join(', ')})`);
    return res.json({ ok: true, mode: req.rt.mode, ...req.rt.reset(b) });
  }).all(methods('POST'));

  api.use((req, res) => bad(res, 'no such endpoint', 404));
  api.use((err, _req, res, _next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large', message: 'request body is too large' });
    if (err.type === 'entity.parse.failed') return bad(res, 'request body is not valid JSON');
    if (err instanceof URIError || err.status === 400) return bad(res, 'malformed request');
    console.error('[agent-audit-trail-lab] api error:', err.message);
    return res.status(500).json({ error: 'server_error' });
  });
  app.get('/api/shelf', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json(shelfInfo()); }); // the header "Shelf" button
  app.use('/api', api);
  app.use((req, res) => bad(res, 'no such endpoint', 404));
  app.use((err, _req, res, _next) => (err instanceof URIError || err.status === 400 ? bad(res, 'malformed request') : res.status(500).json({ error: 'server_error' })));
  return app;
}

// Boot on `port`. Refuses a non-loopback host unless AUDIT_TRAIL_BIND is set.
export async function startHttpServer({ port = serverPort(), host = bindHost(), env = process.env, runtime, webDist = DEFAULT_WEB_DIST, now } = {}) {
  const allowedHosts = parseAllowedHosts(env); // the lab-proxy's names; before any server or timer starts
  assertBindAllowed(host, env);
  modeFrom(env); // refuses live (honestly) and anything but mock
  const customer = loadCustomer();
  const make = () => createRuntime({ ...(now ? { now } : {}), vertical: customer.vertical });
  const rt = runtime || make();
  const health = createHealth({ demoId: 'agent-audit-trail-lab', demoName: 'Agent Audit Trail LAB', version: '0.1.0', runChecks: defaultChecks, allPassed, env });
  return new Promise((resolve, reject) => {
    const httpServer = createApp({ runtime: rt, health, webDist, customer, createWorkspaceRuntime: make, allowedHosts, port }).listen(port, host);
    httpServer.once('error', (e) => { health.stop(); reject(e); });
    httpServer.once('listening', () => {
      const { port: bound } = httpServer.address();
      resolve({
        port: bound, runtime: rt, url: `http://127.0.0.1:${bound}/`,
        close: async () => { health.stop(); await new Promise((r) => { httpServer.closeAllConnections?.(); httpServer.close(r); }); },
      });
    });
  });
}

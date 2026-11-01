// The audit tool surface: exactly three read-only tools. This is the lesson: the surface exposes exactly what is
// implemented, and nothing here can write, delete, reset or reach the hash chain. A tool is handed a read-only
// view of the store (search / get / summary), never the store.
//
// Shape follows the original demo's three tools (search_audit_activities, get_audit_activity, audit_summary).
import { DEFAULT_LIMIT, EVENT_ID_RE, CURSOR_RE, MAX_LIMIT, RETENTION_DAYS, UNVERIFIED } from './store.js';

export class ToolError extends Error {
  constructor(message, code = 'invalid_params') { super(message); this.name = 'ToolError'; this.code = code; }
}

const WORD = /^[A-Za-z0-9._:@/-]{1,128}$/;
const SOURCES = ['idp', 'token', 'gateway', 'policy', 'hitl', 'killswitch'];

export const TOOLS = [
  {
    name: 'search_audit_activities',
    description: `Search audit events from several sources, newest first. Retention is about ${RETENTION_DAYS} days (${UNVERIFIED}); longer windows are clamped, and the result says so, never silently emptied. Paginated: follow nextCursor.`,
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        days: { type: 'integer', description: `How far back to look, 1-${RETENTION_DAYS}. Default ${RETENTION_DAYS}. Larger values are clamped and the result carries a note.` },
        limit: { type: 'integer', description: `Page size, 1-${MAX_LIMIT}. Default ${DEFAULT_LIMIT}. Larger values are clamped and noted.` },
        cursor: { type: 'string', description: 'The nextCursor from the previous page.' },
        eventType: { type: 'string', description: 'Exact normalized type (e.g. gateway.decision) or the source\'s own type label.' },
        source: { type: 'string', enum: SOURCES, description: 'Event source.' },
        traceId: { type: 'string', description: '32 hex characters (W3C trace id).' },
        sessionId: { type: 'string' },
        actor: { type: 'string', description: 'Agent id.' },
        subject: { type: 'string', description: 'Human subject id (sub).' },
        tool: { type: 'string' },
        decision: { type: 'string', description: 'Normalized decision result, e.g. allow, deny, pause, permit, approved, killed.' },
        orphaned: { type: 'boolean', description: 'true: only events that carry no trace id.' },
      },
    },
  },
  {
    name: 'get_audit_activity',
    description: 'Fetch the full detail of one audit event by its id, including the source\'s own raw record (made inert).',
    inputSchema: { type: 'object', additionalProperties: false, required: ['activityId'], properties: { activityId: { type: 'string', description: 'Event id, like ev-000042.' } } },
  },
  {
    name: 'audit_summary',
    description: 'Counts of events in the window by type, source, actor and decision, plus how many traces and how many orphaned (no trace id) events.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { days: { type: 'integer', description: `1-${RETENTION_DAYS}. Default ${RETENTION_DAYS}; larger is clamped and noted.` } } },
  },
];

const bad = (m) => { throw new ToolError(m); };

// Validate arguments against the tool's own schema (small, strict, no dependency). Unknown keys are refused.
export function validateArgs(tool, args) {
  if (args === undefined || args === null) args = {};
  if (typeof args !== 'object' || Array.isArray(args)) bad('arguments must be an object');
  const { properties, required = [] } = tool.inputSchema;
  for (const k of Object.keys(args)) if (!Object.hasOwn(properties, k)) bad(`unknown argument: ${k.slice(0, 40)}`);
  for (const k of required) if (args[k] === undefined) bad(`${k} is required`);
  const out = {};
  for (const [k, v] of Object.entries(args)) {
    if (v === undefined) continue;
    const p = properties[k];
    if (p.type === 'integer') { if (!Number.isInteger(v) || v < 1 || v > 1e9) bad(`${k} must be a positive integer`); }
    else if (p.type === 'boolean') { if (typeof v !== 'boolean') bad(`${k} must be a boolean`); }
    else if (typeof v !== 'string' || !WORD.test(v)) bad(`${k} must be a short plain string`);
    else if (p.enum && !p.enum.includes(v)) bad(`${k} must be one of ${p.enum.join(', ')}`);
    out[k] = v;
  }
  if (out.cursor !== undefined && !CURSOR_RE.test(out.cursor)) bad('cursor is not one this server issued');
  if (out.traceId !== undefined && !/^[0-9a-f]{32}$/.test(out.traceId)) bad('traceId must be 32 lowercase hex characters');
  if (out.activityId !== undefined && !EVENT_ID_RE.test(out.activityId)) bad('activityId must look like ev-000042');
  return out;
}

export function createTools(view) {
  // Refuse anything that is not the frozen read-only view: the tools must never be able to reach ingest, the chain or reset.
  if (!Object.isFrozen(view) || ['ingest', 'append', 'chain', 'reset'].some((k) => k in view)) throw new Error('tools need the read-only view, not the store');
  const byName = new Map(TOOLS.map((t) => [t.name, t]));
  function call(name, args) {
    const tool = typeof name === 'string' && byName.has(name) ? byName.get(name) : null;
    if (!tool) throw new ToolError(`unknown tool: ${String(name).slice(0, 60)}`, 'unknown_tool');
    const a = validateArgs(tool, args);
    if (name === 'search_audit_activities') return view.search(a);
    if (name === 'get_audit_activity') {
      const e = view.get(a.activityId);
      if (!e) throw new ToolError('no such event in the retained window', 'not_found');
      return e;
    }
    return view.summary(a);
  }
  return { list: () => TOOLS, call };
}

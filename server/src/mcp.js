// A small MCP-style JSON-RPC 2.0 endpoint over plain HTTP POST (the Streamable HTTP shape, JSON responses only,
// no MCP sessions (the workspace is chosen by the X-Workspace-Id header), no streaming, no server-initiated messages). Methods: initialize, notifications/initialized, ping,
// tools/list, tools/call. Anything else is "method not found". It accepts and needs no credentials.
import express from 'express';
import { ToolError } from './tools.js';

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];

export function createMcpRouter({ toolsFor }) {
  const router = express.Router();
  router.use(express.json({ limit: '8kb' }));
  router.post('/', (req, res) => {
    const rt = toolsFor(req);
    const rpc = req.body;
    if (Array.isArray(rpc)) return res.json(rpcError(null, -32600, 'batch requests are not supported'));
    if (!rpc || typeof rpc !== 'object' || rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string') return res.json(rpcError(rpc?.id, -32600, 'not a JSON-RPC 2.0 request'));
    const id = rpc.id;
    if (id === undefined) return res.status(202).end(); // a notification: no response body
    if (typeof id !== 'string' && !(typeof id === 'number' && Number.isFinite(id))) return res.json(rpcError(null, -32600, 'id must be a string or a finite number'));
    switch (rpc.method) {
      case 'initialize': {
        const asked = rpc.params?.protocolVersion;
        return res.json({ jsonrpc: '2.0', id, result: {
          protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
          capabilities: { tools: {} },
          serverInfo: { name: 'agent-audit-trail', version: '0.1.0' },
          instructions: 'Read-only audit tools over SEEDED SYNTHETIC events. Three tools exist; there is no write tool.',
        } });
      }
      case 'ping': return res.json({ jsonrpc: '2.0', id, result: {} });
      case 'tools/list': return res.json({ jsonrpc: '2.0', id, result: { tools: rt.list() } });
      case 'tools/call': {
        const name = rpc.params?.name;
        try {
          const out = rt.call(name, rpc.params?.arguments);
          return res.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out, isError: false } });
        } catch (e) {
          if (e instanceof ToolError && e.code === 'unknown_tool') return res.json(rpcError(id, -32602, e.message));
          // A tool-level failure is reported inside the result so the calling agent can read the reason.
          const msg = e instanceof ToolError ? e.message : 'audit tool failed';
          if (!(e instanceof ToolError)) console.error('[agent-audit-trail-lab] tool error:', e.message);
          return res.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `audit tool failed: ${msg}` }], isError: true } });
        }
      }
      default: return res.json(rpcError(id, -32601, `Method not found: ${String(rpc.method).slice(0, 60)}`));
    }
  });
  router.all('/', (_req, res) => res.set('Allow', 'POST').status(405).json({ error: 'method_not_allowed' }));
  router.use((err, _req, res, _next) => {
    if (err.type === 'entity.too.large') return res.status(413).json(rpcError(null, -32600, 'request body is too large'));
    if (err.type === 'entity.parse.failed') return res.status(400).json(rpcError(null, -32700, 'Parse error'));
    console.error('[agent-audit-trail-lab] mcp error:', err.message);
    return res.status(500).json(rpcError(null, -32603, 'Internal error'));
  });
  return router;
}

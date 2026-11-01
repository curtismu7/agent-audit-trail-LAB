// Test helpers. Every test file owns a distinct slice of 6630-6649 so files running in parallel never collide.
import http from 'node:http';
import net from 'node:net';

export const BASES = { api: 6630, mcp: 6633, safety: 6636, guards: 6640, spare: 6644, diagram: 6647 };
const SLICE_END = { api: 6632, mcp: 6635, safety: 6639, guards: 6643, spare: 6646, diagram: 6649 };

const isFree = (port) => new Promise((resolve) => {
  const s = net.createServer();
  s.once('error', () => resolve(false));
  s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
});

// A run of `count` consecutive free loopback ports inside a file's own slice, so a foreign process holding one
// of the usual ports moves the test along instead of failing it. The search resumes after the last run handed
// out (and wraps), so a port is not reused right after a test closed a server on it. Ports stay in 6630-6649.
const cursor = {};
export async function freeBase(slice, count = 4) {
  const first = BASES[slice]; const last = SLICE_END[slice];
  const starts = [];
  for (let s = cursor[slice] ?? first; s + count - 1 <= last; s += 1) starts.push(s);
  for (let s = first; s < (cursor[slice] ?? first) && s + count - 1 <= last; s += 1) starts.push(s);
  for (const start of starts) {
    let ok = true;
    for (let p = start; p < start + count && ok; p += 1) ok = await isFree(p);
    if (ok) { cursor[slice] = start + count; return start; }
  }
  throw new Error(`no ${count} free ports in ${first}-${last}`);
}

// Like fetch, but lets a test set the Host header. Resolves { status, headers, json }.
export function request(port, method, path, { headers = {}, body, host } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, method, path, agent: false, headers: { ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}), ...(host ? { host } : {}), ...headers } }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(raw); } catch { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, json, raw }); });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// A fixed clock and a runtime on it, so no test depends on the wall clock.
import { createRuntime } from '../src/runtime.js';
import { startHttpServer } from '../src/app.js';
export const NOW = new Date('2026-10-21T12:00:00.000Z');
export const mkRuntime = (now = () => NOW) => createRuntime({ now });
export async function boot(slice, runtime = mkRuntime()) {
  const port = await freeBase(slice, 1);
  const srv = await startHttpServer({ port, host: '127.0.0.1', runtime, webDist: null });
  return { ...srv, runtime };
}

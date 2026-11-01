#!/usr/bin/env node
// Reset script (rule 3): asks a RUNNING server to rebuild its seeded store and hash chain, the same as the Reset button.
// Loopback only, port 6600-6649 only. It does not start a server and touches no file.
//   node scripts/reset.mjs                       reset the default workspace on AUDIT_TRAIL_PORT (default 6600)
//   AUDIT_TRAIL_WORKSPACE=ws-1234 node scripts/reset.mjs    reset one workspace
//   node scripts/reset.mjs --vertical=banking    also switch the cast (retail | banking | healthcare)
// The header Reset button in the web app does the same and also puts the diagram boxes back where they started.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { portInRange, serverPort } = await import(pathToFileURL(path.join(root, 'server/src/safety.js')));

export async function resetServer({ port = serverPort(), workspace, vertical } = {}) {
  if (!portInRange(port)) throw new Error(`port ${port} is outside 6600-6649`);
  const res = await fetch(`http://127.0.0.1:${port}/api/reset`, {
    method: 'POST', credentials: 'omit',
    headers: { 'Content-Type': 'application/json', ...(workspace ? { 'X-Workspace-Id': workspace } : {}) },
    body: JSON.stringify(vertical ? { vertical } : {}),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) throw new Error(`reset failed: HTTP ${res.status} ${body?.message ?? body?.error ?? ''}`.trim());
  return body;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const vertical = process.argv.find((a) => a.startsWith('--vertical='))?.slice(11);
    const r = await resetServer({ workspace: process.env.AUDIT_TRAIL_WORKSPACE, vertical });
    console.log(`reset ok: epoch ${r.epoch}, vertical ${r.vertical}, discarded ${r.discardedLength} entries`);
  } catch (e) { console.error(e.message); process.exit(1); }
}

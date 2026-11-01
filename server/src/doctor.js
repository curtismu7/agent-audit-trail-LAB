// Preflight checks shared by `npm run doctor` and GET /api/health. Synchronous, no network, never prints a secret.
// Each check: { id, level: 'pass' | 'info' | 'fail', detail }.
import { modeFrom } from './config.js';
import { DIAGRAM_NAMES, loadDiagram } from './diagramData.js';
import { settingsPath } from './settings.js';
import fs from 'node:fs';
import { PORT_MAX, PORT_MIN, assertBindAllowed, bindHost, portInRange, serverPort } from './safety.js';
import { createRng } from './rng.js';
import { createStore, RETENTION_DAYS } from './store.js';
import { seedAll } from './scenarios.js';
import { TOOLS } from './tools.js';

export function runChecks({ env = process.env } = {}) {
  const checks = [];
  const add = (id, level, detail) => checks.push({ id, level, detail });

  const [major] = process.versions.node.split('.').map(Number);
  const nodeOk = major >= 26;
  add('node', nodeOk ? 'pass' : 'fail', `v${process.versions.node} (need >= 26)`);

  try { add('bind', 'pass', `${assertBindAllowed(bindHost(env), env)}${env.AUDIT_TRAIL_BIND ? ' (AUDIT_TRAIL_BIND opt-in)' : ' (loopback)'}`); }
  catch (e) { add('bind', 'fail', e.message); }

  try { add('mode', 'pass', `${modeFrom(env)} (the only mode this app has; AAT_LAB_MODE=live is refused)`); }
  catch (e) { add('mode', 'fail', e.message); }

  // The shared settings file is optional. Only its existence and permissions are reported, never a value.
  try {
    const file = settingsPath(env);
    if (!fs.existsSync(file)) add('settings', 'info', 'no shared settings file (optional: this app needs none)');
    else {
      const mode = fs.statSync(file).mode & 0o777;
      add('settings', (mode & 0o077) === 0 ? 'pass' : 'info', `shared settings file present, mode ${mode.toString(8)}${(mode & 0o077) === 0 ? '' : ' (should be 600)'}`);
    }
  } catch { add('settings', 'info', 'shared settings file not readable (optional)'); }

  try { for (const n of DIAGRAM_NAMES) loadDiagram(n); add('diagram', 'pass', `${DIAGRAM_NAMES.length} diagram-studio/1 diagram(s) load and validate: ${DIAGRAM_NAMES.join(', ')}`); }
  catch (e) { add('diagram', 'fail', e.message); }

  const port = serverPort(env);
  add('port-range', portInRange(port) ? 'pass' : 'fail', portInRange(port) ? `server port ${port} (within ${PORT_MIN}-${PORT_MAX})` : `server port ${port} is outside ${PORT_MIN}-${PORT_MAX}`);

  try {
    const fixed = new Date('2026-01-15T12:00:00Z');
    const build = () => { const s = createStore({ now: () => fixed, key: Buffer.alloc(32, 7) }); seedAll(s, { rng: createRng(1), now: fixed }); return s; };
    const a = build(); const b = build();
    const same = a.chain.head.hash === b.chain.head.hash;
    const v = a.chain.verify();
    add('seed', same && v.ok ? 'pass' : 'fail', `${a.size} synthetic events, deterministic: ${same}, hash chain verifies: ${v.ok}`);
  } catch (e) { add('seed', 'fail', `seeding failed: ${e.message}`); }

  const names = TOOLS.map((t) => t.name);
  add('tools', names.length === 3 && !names.some((n) => /^(create|write|delete|update|set|put|append|reset|tamper)/.test(n)) ? 'pass' : 'fail', `${names.length} read-only audit tools: ${names.join(', ')}`);
  add('retention', 'info', `window clamps to ${RETENTION_DAYS} days (as observed in a demo environment, UNVERIFIED against product documentation)`);
  add('outbound', 'pass', 'no outbound settings: the audit store is in-process and seeded, no credentials are accepted or sent');
  return checks;
}

export const allPassed = (checks) => checks.every((c) => c.level !== 'fail');

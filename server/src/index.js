import { installNetguard } from './netguard.js';
import { startHttpServer } from './app.js';
import { allPassed, runChecks } from './doctor.js';
import { applySharedSettings } from './settings.js';

installNetguard(); // before anything else can open a socket

// The one shared settings file (rulebook): ~/Development/.env, or STANDALONE_ENV. Optional; only this app's own key is taken; never printed.
applySharedSettings();

const checks = runChecks();
if (!allPassed(checks)) {
  for (const c of checks.filter((x) => x.level === 'fail')) console.error(`[agent-audit-trail-lab] refusing to start: ${c.id}: ${c.detail}`);
  process.exit(1);
}
const { url, runtime } = await startHttpServer();
console.log(`[agent-audit-trail-lab] simulated app (seeded synthetic events, nothing real) at ${url} (mock mode; loopback unless AUDIT_TRAIL_BIND is set)`);
console.log(`[agent-audit-trail-lab] API: GET ${url}api/health | GET ${url}api/scenarios | GET ${url}api/events | POST ${url}mcp | GET ${url}api/join?traceId=... | GET ${url}api/chain/verify`);
console.log(`[agent-audit-trail-lab] ${runtime.store.size} events seeded`);

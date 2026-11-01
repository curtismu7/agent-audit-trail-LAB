// Preflight: the same checks GET /api/health reports from, plus the netguard self-test (it tries to leave the machine by fetch, TCP,
// DNS and UDP, including a UDP connect, and every attempt must be refused), plus whether the port is free.
// Settings come only from the one shared file (~/Development/.env or STANDALONE_ENV), never a per-app .env.
// Prints only pass/fail lines, never the value of a setting. Exit 1 on any failure. Needs no network.
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => import(pathToFileURL(path.join(root, p)));
const { installNetguard, netguardSelfTest } = await load('server/src/netguard.js');
installNetguard();
const { applySharedSettings } = await load('server/src/settings.js');
applySharedSettings();

const { runChecks } = await load('server/src/doctor.js');
const { serverPort, PORT_MIN, PORT_MAX } = await load('server/src/safety.js');
let failed = 0;
const report = (level, name, detail) => {
  if (level === 'fail') failed++;
  console.log(`${level.toUpperCase().padEnd(4)}  ${name}: ${detail}`);
};

for (const c of runChecks()) report(c.level, c.id, c.detail);

const guard = await netguardSelfTest();
report(guard.ok ? 'pass' : 'fail', 'netguard', `${guard.blocked} outbound attempts refused (${guard.detail})`);

const free = (port) => new Promise((resolve) => {
  const s = net.createServer();
  s.once('error', (e) => resolve(e.code));
  s.listen(port, '127.0.0.1', () => s.close(() => resolve(null)));
});
const port = serverPort();
const err = await free(port);
report(err ? 'fail' : 'pass', 'port', err ? `${port} is not free (${err}). Set AUDIT_TRAIL_PORT to a free port in ${PORT_MIN}-${PORT_MAX}` : `${port} is free`);

process.exit(failed ? 1 : 0);

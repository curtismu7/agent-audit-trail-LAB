// Red checks: break one safety behaviour at a time on a throwaway copy and demand that the tests FAIL.
// A mutation the tests survive is a hole in the pins. Slow (runs several test files), so not part of `npm test`.
//   npm run mutation-check
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MUTATIONS = [
  { name: 'retention clamp removed', file: 'store.js', from: 'if (requested > retentionDays) {', to: 'if (false) {', test: 'store.test.js' },
  { name: 'limit cap removed', file: 'store.js', from: 'Math.min(Math.max(wanted, 1), MAX_LIMIT)', to: 'Math.max(wanted, 1)', test: 'store.test.js' },
  { name: 'clamp is silent (no note)', file: 'store.js', from: 'note: `clamped to ${retentionDays} days', to: 'note: `', test: 'store.test.js' },
  { name: 'hash comparison disabled', file: 'chain.js', from: 'if (a.length !== b.length || !crypto.timingSafeEqual(a, b))', to: 'if (false)', test: 'chain.test.js' },
  { name: 'sequence check disabled', file: 'chain.js', from: 'if (e.seq !== expectSeq)', to: 'if (false)', test: 'chain.test.js' },
  { name: 'head checkpoint (truncation) check disabled', file: 'chain.js', from: 'if (checkpoint.seq !== expectSeq - 1 || checkpoint.hash !== prev)', to: 'if (false)', test: 'chain.test.js' },
  { name: 'HMAC key ignored (constant key)', file: 'chain.js', from: "crypto.createHmac('sha256', key)", to: "crypto.createHmac('sha256', 'k')", test: 'chain.test.js' },
  { name: 'join invents a human when none is recorded', file: 'join.js', from: 'signin?.subject ?? withSubject?.subject ?? null', to: "signin?.subject ?? withSubject?.subject ?? 'user-alice'", test: 'join.test.js' },
  { name: 'session id pulls in events that have their own trace', file: 'join.js', from: '!coreIds.has(e.id) && !e.traceId && e.sessionId', to: '!coreIds.has(e.id) && e.sessionId', test: 'join.test.js' },
  { name: 'missing token exchange no longer a gap', file: 'join.js', from: "&& !of('token.exchanged').length) gap(", to: '&& false) gap(', test: 'join.test.js' },
  { name: 'orphan no longer orphaned', file: 'join.js', from: 'orphan: !ambiguous,', to: 'orphan: false,', test: 'join.test.js' },
  { name: 'a write-shaped tool appears', file: 'tools.js', from: "name: 'audit_summary',", to: "name: 'delete_audit_summary',", test: 'tools.test.js' },
  { name: 'tools get the whole store, not a read-only view', file: 'runtime.js', from: 'createTools(rt.store.view)', to: 'createTools(rt.store)', test: 'tools.test.js' },
  { name: 'hidden characters no longer revealed', file: 'normalize.js', from: 'return revealText(v, max);', to: 'return v;', test: 'normalize.test.js' },
  { name: 'invalid traceparent trusted', file: 'trace.js', from: '|| allZero(m[2]) || allZero(m[3])', to: '', test: 'normalize.test.js' },
  { name: 'Host guard removed', file: 'app.js', from: 'app.use(hostGuard);', to: '', test: 'api.test.js' },
  { name: 'CSRF guard removed', file: 'app.js', from: 'app.use(originGuard);', to: '', test: 'api.test.js' },
  { name: 'credential guard removed', file: 'app.js', from: 'app.use(credentialGuard); // every route, static files included', to: '', test: 'api.test.js' },
  { name: 'tamper demo touches the live store', file: 'chain.js', from: 'const copy = snapshot();', to: 'const copy = entries;', test: 'chain.test.js' },
  // ---- AT2 fix pass: mutations the first review found surviving, now pinned
  { name: 'retention boundary off by one (> retention + 1)', file: 'store.js', from: 'if (requested > retentionDays) {', to: 'if (requested > retentionDays + 1) {', test: 'pins.test.js' },
  { name: 'Host regex unanchored', file: 'safety.js', from: 'const HOST_RE = /^(localhost', to: 'const HOST_RE = /(localhost', test: 'pins-http.test.js' },
  { name: 'Host: isLoopbackHost dropped from parseHost', file: 'safety.js', from: 'if (!m || !isLoopbackHost(m[1])) return null;', to: 'if (!m) return null;', test: 'pins-http.test.js' },
  { name: 'Host: octet pattern loosened', file: 'safety.js', from: String.raw`const OCTET = '(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)';`, to: String.raw`const OCTET = '\\d+';`, test: 'pins-http.test.js' },
  { name: 'Origin: https accepted', file: 'safety.js', from: "u.protocol === 'http:' && ", to: '', test: 'pins-http.test.js' },
  { name: 'JSON-only: content-type regex loosened', file: 'safety.js', from: String.raw`/^application\/json\s*(;|$)/i`, to: String.raw`/application\/json/i`, test: 'pins-http.test.js' },
  { name: 'JSON-only: chunked body not counted', file: 'safety.js', from: " || req.headers['transfer-encoding'] !== undefined", to: '', test: 'pins-http.test.js' },
  { name: 'credential list shortened', file: 'safety.js', from: "'x-auth-token', ", to: '', test: 'pins-http.test.js' },
  { name: 'app-level 500 leaks err.message', file: 'app.js', from: "bad(res, 'malformed request') : res.status(500).json({ error: 'server_error' })", to: "bad(res, 'malformed request') : res.status(500).json({ error: err.message })", test: 'pins-http.test.js' },
  { name: 'mcp 500 leaks err.stack', file: 'mcp.js', from: "rpcError(null, -32603, 'Internal error')", to: 'rpcError(null, -32603, err.stack)', test: 'pins-http.test.js' },
  { name: 'mcp non-finite id accepted', file: 'mcp.js', from: "!(typeof id === 'number' && Number.isFinite(id))", to: "typeof id !== 'number'", test: 'pins-http.test.js' },
  { name: 'REST repeated query key accepted', file: 'app.js', from: 'if (k in out) throw new ToolError', to: 'if (false) throw new ToolError', test: 'pins-http.test.js' },
  { name: 'retention-demo upper bound loosened', file: 'app.js', from: 'Number(d) > 365', to: 'Number(d) > 36500', test: 'pins-http.test.js' },
  { name: 'tamper-demo seq upper bound removed', file: 'app.js', from: 'b.seq > 100000', to: 'false', test: 'pins-http.test.js' },
  { name: 'validateArgs uses `in` instead of own-property', file: 'tools.js', from: 'if (!Object.hasOwn(properties, k))', to: 'if (!(k in properties))', test: 'pins-http.test.js' },
  { name: 'integer upper bound removed', file: 'tools.js', from: ' || v > 1e9', to: '', test: 'pins-http.test.js' },
  { name: 'chain MAC omits at', file: 'chain.js', from: 'update(canonical({ seq: e.seq, at: e.at,', to: 'update(canonical({ seq: e.seq,', test: 'pins.test.js' },
  { name: 'chain MAC omits prevHash', file: 'chain.js', from: "update(canonical({ seq: e.seq, at: e.at, event: e.event, prevHash: e.prevHash }))", to: "update(canonical({ seq: e.seq, at: e.at, event: e.event }))", test: 'pins.test.js' },
  { name: 'chain append keeps the caller object', file: 'chain.js', from: 'event: structuredClone(event)', to: 'event: event', test: 'pins.test.js' },
  { name: 'nextCursor handed out on an exactly-full last page', file: 'store.js', from: 'nextCursor: rows.length > used', to: 'nextCursor: rows.length >= used', test: 'pins.test.js' },
  { name: 'window edge inclusive', file: 'store.js', from: 'Date.parse(e.recordedAt) > s)', to: 'Date.parse(e.recordedAt) >= s)', test: 'pins.test.js' },
  { name: 'decision filter ignored', file: 'store.js', from: '(e.decision ? e.decision.result : null) !== f.decision', to: 'false', test: 'pins.test.js' },
  { name: 'traceId filter ignored', file: 'store.js', from: 'if (f.traceId !== undefined && e.traceId !== f.traceId) return false;', to: '', test: 'pins.test.js' },
  { name: 'session window before widened', file: 'join.js', from: 'SESSION_BEFORE_MS = 60 * 60_000', to: 'SESSION_BEFORE_MS = 6000 * 60_000', test: 'pins.test.js' },
  { name: 'session window after widened', file: 'join.js', from: 'SESSION_AFTER_MS = 10 * 60_000', to: 'SESSION_AFTER_MS = 1000 * 60_000', test: 'pins.test.js' },
  { name: 'session time window ignored', file: 'join.js', from: ' && ms(e) >= start - SESSION_BEFORE_MS && ms(e) <= end + SESSION_AFTER_MS', to: '', test: 'pins.test.js' },
  { name: 'possiblyRelated any actor', file: 'join.js', from: 'e.actor && o.actor === e.actor && ', to: '', test: 'pins.test.js' },
  { name: 'orphan link label changed', file: 'join.js', from: "pub(e, 'seed', ms(e))", to: "pub(e, 'trace', ms(e))", test: 'pins.test.js' },
  { name: 'byEvent traced-event routing disabled', file: 'join.js', from: 'if (e.traceId) return assemble(', to: 'if (false) return assemble(', test: 'pins.test.js' },
  { name: 'inferred sign-in stated as plain fact', file: 'join.js', from: "const q = inferredIds.has(basis.id) ? INFERRED : '';", to: "const q = '';", test: 'pins.test.js' },
  { name: 'sentence fact cap removed', file: 'join.js', from: 'if (facts.length >= MAX_FACTS)', to: 'if (false)', test: 'pins.test.js' },
  { name: 'token.exchanged actor = oldest delegate', file: 'normalize.js', from: 't(chain[chain.length - 1])', to: 't(chain[0])', test: 'pins.test.js' },
  { name: 'delegation cycle not detected', file: 'normalize.js', from: 'if (out.includes(cur.sub))', to: 'if (false)', test: 'pins.test.js' },
  { name: 'delegation cap not flagged', file: 'normalize.js', from: 'if (out.length >= MAX_HOPS)', to: 'if (false)', test: 'pins.test.js' },
  { name: 'decision lower-cased after reveal', file: 'normalize.js', from: "t(typeof result === 'string' ? result.toLowerCase() : result, 40)", to: 't(result, 40)', test: 'pins.test.js' },
  { name: 'timestamp format regex replaced', file: 'normalize.js', from: String.raw`/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(v)`, to: '/./.test(v)', test: 'pins.test.js' },
  { name: 'timestamp range bound removed', file: 'normalize.js', from: ' || ms < MIN_MS || ms > MAX_MS', to: '', test: 'pins.test.js' },
  { name: 'token scopes unbounded', file: 'normalize.js', from: "filter(Boolean).slice(0, 30)", to: 'filter(Boolean)', test: 'pins.test.js' },
  { name: 'raw must be object reduced to null check', file: 'normalize.js', from: "raw === null || typeof raw !== 'object' || Array.isArray(raw)", to: 'raw === null', test: 'pins.test.js' },
  { name: 'invalid-trace-id flag removed', file: 'normalize.js', from: "flags.add('invalid-trace-id'); ", to: '', test: 'pins.test.js' },
  { name: 'tag block not revealed', file: 'sanitize.js', from: '[0xE0000, 0xE007F], ', to: '', test: 'pins.test.js' },
  { name: 'C1 controls not revealed', file: 'sanitize.js', from: String.raw`\u007F-\u009F`, to: String.raw`\u007F`, test: 'pins.test.js' },
  { name: 'BOM not revealed', file: 'sanitize.js', from: '[0xFEFF], ', to: '', test: 'pins.test.js' },
  { name: 'inertValue key cap removed', file: 'sanitize.js', from: 'Object.entries(value).slice(0, 50)', to: 'Object.entries(value)', test: 'pins.test.js' },
  { name: 'all-zero trace id accepted', file: 'trace.js', from: 'TRACE_ID_RE.test(v) && !allZero(v)', to: 'TRACE_ID_RE.test(v)', test: 'pins-http.test.js' },
  { name: 'workspace header ignored (everyone shares one store)', file: 'app.js', from: 'req.workspaceId = id ?? DEFAULT_WORKSPACE;', to: 'req.workspaceId = DEFAULT_WORKSPACE;', test: 'pins-http.test.js' },
  { name: 'mode check removed (live would start)', file: 'app.js', from: 'modeFrom(env); // refuses live (honestly) and anything but mock', to: '', test: 'pins-http.test.js' },
  // ---- LAB move: mode setting, settings file, netguard, diagram data
  { name: 'live is accepted as a mode', file: 'config.js', from: "if (m === 'live') throw new Error(LIVE_REFUSAL);", to: '', test: 'pins-http.test.js' },
  { name: 'a bare MODE switches the app', file: 'config.js', from: 'const raw = env.AAT_LAB_MODE;', to: "const raw = env.AAT_LAB_MODE ?? env['MODE'];", test: 'pins-http.test.js' },
  { name: 'the settings file hands over every key', file: 'settings.js', from: "Object.fromEntries(SETTINGS_KEYS.filter((k) => typeof parsed[k] === 'string' && parsed[k] !== '').map((k) => [k, parsed[k]]))", to: 'Object.fromEntries(Object.keys(parsed).map((k) => [k, parsed[k]]))', test: 'settings.test.js' },
  { name: 'the settings file overrides the real environment', file: 'settings.js', from: 'if (env[k] === undefined) env[k] = v;', to: 'env[k] = v;', test: 'settings.test.js' },
  { name: 'UDP connect guard disabled', file: 'netguard.js', from: 'if (!ok) { attempts.push(`udp-connect:${addr}`);', to: 'if (false) { attempts.push(`udp-connect:${addr}`);', test: 'netguard.test.js' },
  { name: 'UDP send guard disabled', file: 'netguard.js', from: 'if (!ok) { attempts.push(`udp:${addr}`);', to: 'if (false) { attempts.push(`udp:${addr}`);', test: 'netguard.test.js' },
  { name: 'fetch guard disabled', file: 'netguard.js', from: 'if (!isLoopbackHost(url.hostname)) { attempts.push(`fetch:', to: 'if (false) { attempts.push(`fetch:', test: 'netguard.test.js' },
  { name: 'diagram lookup uses `in`', file: 'diagramData.js', from: 'Object.hasOwn(DOCS, name)', to: 'name in DOCS', test: 'diagram.test.js' },
  { name: 'diagram route accepts extra query keys', file: 'app.js', from: "keys.some((k) => k !== 'name') || ", to: '', test: 'diagram.test.js' },
  { name: 'workspace cap removed', file: 'workspaces.js', from: 'while (map.size >= max) {', to: 'while (false) {', test: 'pins-http.test.js' },
  { name: 'customer config allows markup', file: 'config.js', from: " && !/[<>{}]/.test(v)", to: '', test: 'pins-http.test.js' },
  { name: 'reset accepts any vertical', file: 'app.js', from: '!VERTICALS.includes(b.vertical)', to: 'false', test: 'pins-http.test.js' },
];

function copyTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aat-mut-'));
  fs.mkdirSync(path.join(dir, 'server'));
  for (const d of ['src', 'test', 'diagrams']) fs.cpSync(path.join(root, 'server', d), path.join(dir, 'server', d), { recursive: true });
  fs.cpSync(path.join(root, 'content'), path.join(dir, 'content'), { recursive: true });
  fs.copyFileSync(path.join(root, 'server/package.json'), path.join(dir, 'server/package.json'));
  fs.copyFileSync(path.join(root, 'package.json'), path.join(dir, 'package.json'));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'));
  return dir;
}
const run = (dir, testFile) => spawnSync(process.execPath, ['--test', ...[].concat(testFile).map((f) => `test/${f}`)], { cwd: path.join(dir, 'server'), encoding: 'utf8', timeout: 180_000, killSignal: 'SIGKILL' }).status ?? 'timeout'; // a hang or crash counts as killed

const dir = copyTree();
let survived = 0;
try {
  const base = run(dir, 'store.test.js');
  if (base !== 0) { console.error('baseline copy does not pass; aborting'); process.exit(2); }
  for (const m of MUTATIONS) {
    const file = path.join(dir, 'server/src', m.file);
    const original = fs.readFileSync(path.join(root, 'server/src', m.file), 'utf8');
    if (!original.includes(m.from)) { console.log(`ERROR  ${m.name}: pattern not found in ${m.file}`); survived++; continue; }
    fs.writeFileSync(file, original.replace(m.from, m.to));
    const status = run(dir, m.test);
    fs.writeFileSync(file, original);
    if (status === 0) { survived++; console.log(`SURVIVED  ${m.name}  (${m.test} still passes: a hole)`); } else console.log(`killed    ${m.name}`);
  }
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
console.log(survived ? `${survived} mutation(s) survived` : `all ${MUTATIONS.length} mutations killed`);
process.exit(survived ? 1 : 0);

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp, UI_CSP } from '../src/app.js';
import { createHealth } from '../src/health.js';
import { freeBase, mkRuntime, request } from './helpers.js';

async function boot(t, webDist) {
  const port = await freeBase('spare', 1);
  const health = createHealth({ demoId: 'agent-audit-trail-lab', demoName: 'Agent Audit Trail LAB', version: '0.1.0', runChecks: () => [{ id: 'x', level: 'pass', detail: '' }], allPassed: (cs) => (cs || []).every((x) => x?.level !== 'fail') });
  const server = createApp({ runtime: mkRuntime(), health, webDist }).listen(port, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(async () => { health.stop(); server.closeAllConnections(); await new Promise((r) => server.close(r)); });
  return port;
}
function distWith(t, files = {}) {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'aat-dist-'));
  t.after(() => fs.rmSync(dist, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>ui</title>');
  for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dist, f)), { recursive: true }); fs.writeFileSync(path.join(dist, f), c); }
  return dist;
}

test('the built UI is served by the server itself with a same-origin CSP; Host and credential guards still apply', async (t) => {
  const port = await boot(t, distWith(t, { 'assets/a.js': 'console.log(1)', '.secret': 'x' }));
  const root = await request(port, 'GET', '/');
  assert.equal(root.status, 200);
  assert.match(root.headers['content-type'], /text\/html/);
  const csp = root.headers['content-security-policy'];
  assert.equal(csp, UI_CSP);
  assert.doesNotMatch(csp, /unsafe-eval|script-src[^;]*unsafe-inline|https?:|\*/);
  const dir = (n) => csp.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${n} `));
  assert.equal(dir('script-src'), "script-src 'self'");
  assert.equal(dir('connect-src'), "connect-src 'self'");
  assert.equal(dir('frame-ancestors'), "frame-ancestors 'none'");
  assert.equal(dir('object-src'), "object-src 'none'");
  assert.equal(dir('base-uri'), "base-uri 'none'");
  assert.equal(dir('form-action'), "form-action 'none'");
  assert.equal(root.headers['x-content-type-options'], 'nosniff');
  assert.equal(root.headers['cache-control'], 'no-store');
  assert.equal((await request(port, 'GET', '/assets/a.js')).status, 200);
  assert.equal((await request(port, 'GET', '/.secret')).status, 404);
  assert.equal((await request(port, 'GET', '/', { host: 'evil.example.com' })).status, 421);
  assert.equal((await request(port, 'GET', '/assets/a.js', { host: 'evil.example.com' })).status, 421);
  assert.equal((await request(port, 'GET', '/', { headers: { authorization: 'x' } })).status, 400);
  assert.ok((await request(port, 'GET', '/%ZZ')).status < 500);
  // the API keeps default-src 'none'
  assert.equal((await request(port, 'GET', '/api/health')).headers['content-security-policy'], "default-src 'none'");
  assert.equal((await request(port, 'GET', '/api/nothing')).headers['content-security-policy'], "default-src 'none'");
  // static serving opens no write path
  assert.equal((await request(port, 'POST', '/api/reset', { headers: { origin: 'http://evil.example' } })).status, 403);
});

test('without a built UI, or with webDist null, GET / is a JSON 404', async (t) => {
  const a = await boot(t, path.join(os.tmpdir(), 'aat-no-such-dist'));
  const res = await request(a, 'GET', '/');
  assert.equal(res.status, 404);
  assert.equal(res.json.error, 'not_found');
  assert.equal((await request(await boot(t, null), 'GET', '/')).status, 404);
});

test('the real web/dist, when built, has no external origin in its HTML and only same-origin assets', (t) => {
  const dist = path.resolve(import.meta.dirname, '../../web/dist/index.html');
  // CI builds before it tests, so a missing build there is a failure, not a skip.
  if (!fs.existsSync(dist)) { if (process.env.CI) assert.fail('web/dist is not built; CI must run `npm run build` before `npm test`'); return t.skip('web/dist not built (run `npm run build`)'); }
  const html = fs.readFileSync(dist, 'utf8');
  assert.doesNotMatch(html, /(?:src|href)="https?:/);
  assert.match(html, /<script type="module"[^>]+src="\/assets\//);
});

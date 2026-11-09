import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (['node_modules', 'dist', '.git', '.data'].includes(e.name) ? [] : e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

test('the shared stylesheet is vendored and loads before the app stylesheet; app CSS follows the CSS standard', () => {
  assert.ok(fs.existsSync(path.join(root, 'web/src/styles/standalone-ui.css')));
  const css = read('web/src/app.css');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(css), 'no colour literal');
  assert.ok(!/prefers-color-scheme/.test(css)); assert.ok(!/!important/.test(css)); assert.ok(!/font-style:\s*italic/.test(css));
  const widths = [...css.matchAll(/@media \((?:max|min)-width: (\d+)px\)/g)].map((m) => m[1]);
  assert.ok(widths.length > 0 && widths.every((w) => w === '600' || w === '900'), widths.join());
  assert.ok(!/purple|violet|magenta|indigo/i.test(css));
  const main = read('web/src/main.jsx');
  assert.ok(main.indexOf('standalone-ui.css') > 0 && main.indexOf('standalone-ui.css') < main.indexOf('app.css'));
  assert.ok(!/<em>|<i>/.test(walk(path.join(root, 'web/src/components')).map((f) => fs.readFileSync(f, 'utf8')).join('\n')), 'no italics via em or i');
});

test('the CI workflow is GitHub-hosted, Node 26 only, and carries build, test, doctor, e2e, forbidden-strings and gitleaks jobs', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /runs-on: ubuntu-latest/);
  assert.ok(!/self-hosted/.test(ci));
  const versions = [...ci.matchAll(/node-version: (\S+)/g)].map((m) => m[1]);
  assert.ok(versions.length >= 3 && versions.every((v) => v === '26'), versions.join());
  for (const job of ['build:', 'test:', 'doctor:', 'e2e:', 'forbidden-strings:', 'gitleaks:']) assert.match(ci, new RegExp(`^  ${job}`, 'm'), job);
  assert.match(ci, /actions\/checkout@v5/); assert.match(ci, /actions\/setup-node@v5/);
  assert.match(ci, /AUDIT_TRAIL_PORT=6609 npm run doctor/);
  assert.match(ci, /validate-content-pack/);
  assert.match(ci, /npm run e2e/);
});

test('package.json requires Node 26 and the scripts the standard asks for exist', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.engines.node, '>=26');
  for (const s of ['start', 'dev', 'test', 'build', 'doctor', 'reset']) assert.ok(pkg.scripts[s], s);
});

test('README follows the README standard: title ends in LAB, plain Tier, Repo and Catalog lines, the port text, the 12 sections in order', () => {
  const r = read('README.md');
  assert.match(r.split('\n')[0], /^# .* LAB$/);
  assert.match(r, /^Tier: Demo$/m);
  assert.match(r, /^Repo: https:\/\/github\.com\/curtismu7\/agent-audit-trail-LAB$/m);
  assert.match(r, /^Catalog: D17$/m);
  const order = ['What is simulated', 'Run from a clone', 'Settings file', 'Ports, and what to do if the port is taken', 'Mock and live modes', 'Health, doctor and reset', 'Docker', 'Tests', 'Troubleshooting', 'Ownership'].map((h) => r.indexOf(`\n## ${h}`));
  assert.ok(order.every((i) => i > 0), order.join());
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'sections are in order');
  assert.match(r, /lsof -iTCP:6600 -sTCP:LISTEN -n -P/);
  assert.match(r, /AUDIT_TRAIL_PORT=<other port> npm start/);
  assert.match(r, /Port range for this app: 6600-6649\./);
  assert.ok(!/ping-devops|cmuir/i.test(r));
});

test('no k8s manifests, no hosted build, no bare MODE and no per-app .env loader anywhere in the shipped code', () => {
  assert.ok(!fs.existsSync(path.join(root, 'k8s')));
  const files = walk(root).filter((f) => /\.(m?js|jsx|ya?ml)$/.test(f) && !/\.test\.|mutation-check|package-lock/.test(f)).concat([path.join(root, 'Dockerfile'), path.join(root, 'docker-compose.yml')]);
  const code = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  assert.doesNotMatch(code, /process\.env\.MODE|env\.MODE\b|\bMODE=/);
  assert.doesNotMatch(code, /AUDIT_TRAIL_HOSTED|__SE_HOST__|__IMAGE__|loadEnvFile/);
});

// local.ping-devops.com is the family lab-proxy's public origin (rulebook: labs are reached at https://local.ping-devops.com:8443).
test('no shipped text carries a foreign identifier: only .example and .invalid hosts, no tenant-style ids', () => {
  const hits = [];
  for (const f of walk(root)) {
    if (/package-lock\.json$|standalone-ui\.css$|\.png$/.test(f) || f.endsWith('repo.test.mjs')) continue;
    const t = fs.readFileSync(f, 'utf8');
    for (const m of t.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
      const host = m[1].toLowerCase().replace(/\.$/, '');
      if (!(/(^|\.)(example|invalid|localhost)$/.test(host) || host === '127.0.0.1' || ['github.com', 'www.w3.org', 'json-schema.org', 'registry.npmjs.org', 'claude.com', 'react.dev', 'reactjs.org', 'w3.org', 'github.io', 'raw.githubusercontent.com', 'npmjs.org', 'nodejs.org', 'playwright.dev', 'xyflow.com', 'reactflow.dev', 'opensource.org', 'tc39.es', 'spdx.org', 'local.ping-devops.com'].includes(host))) hits.push(`${path.relative(root, f)}: ${host}`);
    }
    if (/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(t)) hits.push(`${path.relative(root, f)}: uuid-shaped id`);
  }
  assert.deepEqual(hits, []);
});

test('the shelf entry and the content pack agree on the catalog id, and the web tests do not depend on an author path', () => {
  assert.equal(JSON.parse(read('docs/shelf-entry.json')).demos[0].catalogId, 'D17');
  assert.equal(JSON.parse(read('content-pack.json')).demo.catalog, 'D17');
  for (const f of walk(path.join(root, 'web/src')).filter((x) => /test/.test(x))) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /\/Users\//, f);
});

test('the shipped scripts are portable: no author home path, and e2e reads its overlap helper from this repo', () => {
  const files = walk(path.join(root, 'scripts')).filter((f) => !f.endsWith('.test.mjs'));
  assert.ok(files.some((f) => f.endsWith('diagram-overlap.js')), 'the overlap helper ships in scripts/');
  for (const f of files) assert.ok(!/\/Users\/|\/home\/[a-z]/.test(fs.readFileSync(f, 'utf8')), `${path.relative(root, f)} has an absolute home path`);
  assert.match(read('scripts/e2e.mjs'), /path\.join\(root, 'scripts', 'diagram-overlap\.js'\)/);
});

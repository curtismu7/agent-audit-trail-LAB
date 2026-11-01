import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = new URL('..', import.meta.url).pathname;
const docs = ['README.md', 'docs/safety.md', 'docs/architecture.md', 'docs/talk-track.md', 'CLAUDE.md'];
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('relative links in README and docs resolve to files that exist', () => {
  for (const d of docs) {
    for (const m of read(d).matchAll(/\]\((?!https?:|#|mailto:)([^)#\s]+)/g)) {
      assert.ok(fs.existsSync(path.resolve(path.dirname(path.join(root, d)), m[1])), `${d} links to missing ${m[1]}`);
    }
  }
});

test('every npm script and source file the docs name exists', () => {
  const pkg = JSON.parse(read('package.json'));
  const serverPkg = JSON.parse(read('server/package.json'));
  for (const d of docs) {
    const text = read(d);
    for (const m of text.matchAll(/npm run ([\w-]+)(?! -w)/g)) assert.ok(pkg.scripts[m[1]] || serverPkg.scripts[m[1]], `${d}: npm run ${m[1]} does not exist`);
    for (const m of text.matchAll(/`((?:server|scripts)\/[\w./-]+\.(?:js|mjs))`/g)) assert.ok(fs.existsSync(path.join(root, m[1])), `${d} names missing file ${m[1]}`);
  }
});

test('every API route the README names exists in app.js', () => {
  const app = read('server/src/app.js');
  for (const m of read('README.md').matchAll(/`(GET|POST) \/api\/([\w/:-]+)/g)) {
    const route = `/${m[2].replace(/\/$/, '')}`.replace(/\/:\w+/g, '/:');
    const pattern = route.split('/').filter(Boolean).map((seg) => (seg === ':' ? ':\\w+' : seg)).join('/');
    assert.match(app, new RegExp(`'/${pattern}'`), `app.js has no ${m[1]} ${route}`);
  }
});

test('every scenario id is named in the README, the architecture doc and the talk track', () => {
  const ids = [...fs.readFileSync(path.join(root, 'server/src/scenarios.js'), 'utf8').matchAll(/^  \{ id: '([\w-]+)'/gm)].map((m) => m[1]);
  assert.equal(ids.length, 6);
  for (const id of ids) for (const d of ['README.md', 'docs/architecture.md', 'docs/talk-track.md']) assert.ok(read(d).includes(`\`${id}\``), `${d} names ${id}`);
});

test('the docs declare the tier and label retention and field names UNVERIFIED', () => {
  assert.match(read('README.md'), /^Tier: Demo$/m);
  assert.match(read('README.md'), /^Catalog: D17$/m);
  for (const d of ['README.md', 'docs/safety.md']) assert.match(read(d), /UNVERIFIED/, d);
  assert.match(read('docs/safety.md'), /as observed in the demo environment/i);
  assert.match(read('docs/safety.md'), /no claim about real retention/i);
});

test('required repository files exist', () => {
  for (const f of ['LICENSE', 'CHANGELOG.md', '.gitignore', '.nvmrc', '.githooks/pre-commit', '.github/workflows/ci.yml', 'Dockerfile', 'docker-compose.yml', 'scripts/doctor.mjs', 'scripts/reset.mjs', 'CLAUDE.md', 'docs/talk-track.md', 'docs/shelf-entry.json', 'customer.config.example.json', 'web/src/styles/standalone-ui.css']) assert.ok(fs.existsSync(path.join(root, f)), f);
  assert.match(read('LICENSE'), /^MIT License/);
  assert.match(read('.githooks/pre-commit'), /gitleaks protect --staged/);
});

test('no EC key generation anywhere (it aborted on Node 20 and the rule stays)', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.name === 'node_modules' || e.name === '.git' ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const forbidden = ['generate', 'Key', 'Pair'].join('');
  for (const f of walk(root).filter((p) => /\.(m?js|jsx)$/.test(p) && !p.endsWith('docs.test.mjs'))) assert.ok(!fs.readFileSync(f, 'utf8').includes(forbidden), f);
});

test('CLAUDE.md is short', () => {
  assert.ok(read('CLAUDE.md').split('\n').length <= 60);
});

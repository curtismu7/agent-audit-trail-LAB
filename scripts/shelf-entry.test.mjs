import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const entry = JSON.parse(read('docs/shelf-entry.json'));

test('docs/shelf-entry.json is valid and portable: relative composeFile, loopback url, health path, catalog id D17', () => {
  assert.equal(entry.demos.length, 1);
  const [d] = entry.demos;
  assert.equal(d.id, 'agent-audit-trail-lab');
  assert.equal(d.kind, 'Demo');
  assert.equal(d.catalogId, 'D17');
  assert.equal(d.healthPath, '/api/health');
  assert.match(d.url, /^http:\/\/localhost:66[0-4]\d$/);
  assert.equal(d.composeFile, 'agent-audit-trail-LAB/docker-compose.yml');
  assert.ok(!path.isAbsolute(d.composeFile), 'composeFile must be relative or a placeholder');
  assert.ok(!/\/Users\/|\/home\//.test(JSON.stringify(entry)), 'no absolute home path');
  assert.ok(d.description.length <= 300 && d.name.length <= 300);
  assert.deepEqual(d.composeOverlays, []);
});

test('the entry matches this app: package scripts, compose publishing and the port', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.scripts.start && pkg.scripts.doctor && pkg.scripts.reset);
  assert.match(read('docker-compose.yml'), /127\.0\.0\.1:\$\{HOST_PORT:-6600\}:6600/);
  assert.ok(fs.existsSync(path.join(root, path.basename(entry.demos[0].composeFile))), 'the compose file named by the entry exists at the repo root');
});

test('the catalog id is the same in the shelf entry and the content pack', () => {
  assert.equal(JSON.parse(read('content-pack.json')).demo.catalog, entry.demos[0].catalogId);
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { startHttpServer } from '../server/src/app.js';
import { freeBase, mkRuntime } from '../server/test/helpers.js';
import { resetServer } from './reset.mjs';

test('the reset script rebuilds the store of a running server (epoch moves, chain verifies) and can switch the cast', async () => {
  const port = await freeBase('spare', 1);
  const srv = await startHttpServer({ port, host: '127.0.0.1', runtime: mkRuntime(), webDist: null });
  try {
    const info = () => fetch(`http://127.0.0.1:${port}/api/info`).then((r) => r.json());
    const before = await info();
    await fetch(`http://127.0.0.1:${port}/api/scenarios/normal-purchase/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.ok((await info()).events > before.events);
    const r = await resetServer({ port, vertical: 'banking' });
    assert.equal(r.ok, true); assert.equal(r.vertical, 'banking');
    const after = await info();
    assert.equal(after.events, before.events); assert.equal(after.epoch, before.epoch + 1); assert.equal(after.vertical, 'banking');
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/chain/verify`).then((x) => x.json())).ok, true);
    await assert.rejects(() => resetServer({ port, vertical: 'nope' }), /reset failed/);
  } finally { await srv.close(); }
});

test('the reset script refuses a port outside 6600-6649 and exits non-zero when nothing listens', async () => {
  await assert.rejects(() => resetServer({ port: 8080 }), /outside 6600-6649/);
  const port = await freeBase('spare', 1);
  const r = spawnSync(process.execPath, ['scripts/reset.mjs'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, AUDIT_TRAIL_PORT: String(port) }, encoding: 'utf8' });
  assert.equal(r.status, 1);
});

import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { test } from 'node:test';
import { installNetguard, netguardSelfTest } from '../src/netguard.js';
import { boot, request } from './helpers.js';

test('netguard self-test: fetch, TCP, DNS, UDP send and UDP connect are all refused and recorded', async () => {
  const guard = installNetguard();
  try {
    const r = await netguardSelfTest();
    assert.equal(r.ok, true, r.detail);
    assert.equal(r.blocked, 7);
    for (const what of ['fetch', 'socket', 'socket-ip', 'dns', 'dns-resolve', 'udp', 'udp-connect']) assert.match(r.detail, new RegExp(`${what}: blocked`));
    assert.equal(guard.attempts.length, 0, 'self-test attempts are not counted as real attempts');
  } finally { guard.restore(); }
});

test('netguard: a connected UDP socket cannot be pointed away from loopback, and loopback still works', async () => {
  const guard = installNetguard();
  try {
    const s = dgram.createSocket('udp4');
    try {
      assert.throws(() => s.connect(9, '192.0.2.1'), /network blocked/);
      assert.throws(() => s.connect(9, 'example.invalid'), /network blocked/);
      assert.throws(() => s.connect(9, 5), /network blocked/);
    } finally { s.close(); }
    assert.deepEqual(guard.attempts, ['udp-connect:192.0.2.1', 'udp-connect:example.invalid', 'udp-connect:5']);
    guard.attempts.length = 0;
    const lo = dgram.createSocket('udp4');
    await new Promise((resolve, reject) => { lo.once('error', reject); lo.connect(9, '127.0.0.1', resolve); });
    lo.close();
    assert.deepEqual(guard.attempts, []);
  } finally { guard.restore(); }
});

test('a whole run of the app makes zero outbound attempts', async () => {
  const guard = installNetguard();
  const s = await boot('safety');
  try {
    for (const id of ['normal-purchase', 'denied-scope', 'paused-approved', 'killed-mid-run', 'orphaned-event', 'two-hop-delegation']) {
      assert.equal((await request(s.port, 'POST', `/api/scenarios/${id}/run`, { body: {} })).status, 200);
    }
    for (const p of ['/api/health', '/api/info', '/api/events?days=30', '/api/events/summary', '/api/chain/verify', '/api/retention-demo', '/api/diagram']) assert.equal((await request(s.port, 'GET', p)).status, 200, p);
    assert.equal((await request(s.port, 'POST', '/api/chain/tamper-demo', { body: { kind: 'edit' } })).status, 200);
    assert.equal((await request(s.port, 'POST', '/api/reset', { body: {} })).status, 200);
    assert.deepEqual(guard.attempts, [], 'no non-loopback socket, DNS lookup, fetch or UDP send was attempted');
  } finally { await s.close(); guard.restore(); }
});

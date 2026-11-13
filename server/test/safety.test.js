import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PORT_MAX, PORT_MIN, assertBindAllowed, bindHost, isLoopbackHost, parseHost, portInRange, serverPort } from '../src/safety.js';
import { allPassed, runChecks } from '../src/doctor.js';
import { createHealth } from '../src/health.js';

test('ports stay in 6600-6649 and the default is 6600', () => {
  assert.equal(PORT_MIN, 6600); assert.equal(PORT_MAX, 6649); assert.equal(serverPort({}), 6600);
  for (const p of [6600, 6649]) assert.ok(portInRange(p));
  for (const p of [6599, 6650, 8080, 5173, 4000, 0, 66.5, NaN]) assert.ok(!portInRange(p), String(p));
});

test('bind: loopback by default; a wildcard bind is refused unless AUDIT_TRAIL_BIND opts in', () => {
  assert.equal(bindHost({}), '127.0.0.1');
  assert.throws(() => assertBindAllowed('0.0.0.0', {}), /loopback only/);
  assert.throws(() => assertBindAllowed('192.0.2.1', {}), /loopback only/);
  assert.equal(assertBindAllowed('127.0.0.1', {}), '127.0.0.1');
  assert.equal(assertBindAllowed('0.0.0.0', { AUDIT_TRAIL_BIND: '0.0.0.0' }), '0.0.0.0');
});

test('Host parsing is strict', () => {
  for (const h of ['localhost:6600', '127.0.0.1:6600', '[::1]:6600', 'LOCALHOST', '127.1.2.3']) assert.ok(parseHost(h), h);
  for (const h of ['evil.example', 'localhost.evil.example', '127.0.0.1.evil.example', 'evil.example:6600', '', undefined, '127.0.0.1:99999', '0.0.0.0', 'localhost:6600@evil.example', '[::1', '127.0.0.1 evil']) assert.equal(parseHost(h), null, String(h));
  assert.ok(isLoopbackHost('127.0.0.1') && !isLoopbackHost('10.0.0.1') && !isLoopbackHost('128.0.0.1'));
});

test('doctor passes here, and fails when the port is outside the range or the bind is not loopback', () => {
  assert.equal(allPassed(runChecks({ env: {} })), true);
  assert.equal(allPassed(runChecks({ env: { AUDIT_TRAIL_PORT: '8080' } })), false);
  assert.equal(allPassed(runChecks({ env: { AUDIT_TRAIL_BIND: '0.0.0.0', AUDIT_TRAIL_PORT: '6600' } })), true, 'the container opt-in is allowed');
  const checks = runChecks({ env: {} });
  assert.deepEqual(checks.map((c) => c.id), ['node', 'bind', 'mode', 'settings', 'diagram', 'port-range', 'seed', 'tools', 'retention', 'outbound']);
  assert.match(checks.find((c) => c.id === 'retention').detail, /UNVERIFIED/);
});

test('health reports demo-health/1 and degrades to broken when a check fails', () => {
  const ok = createHealth({ demoId: 'agent-audit-trail-lab', demoName: 'Agent Audit Trail LAB', version: '0.1.0', runChecks: () => [{ id: 'x', level: 'pass', detail: '' }], allPassed: (cs) => (cs || []).every((x) => x?.level !== 'fail'), intervalMs: 1e9 });
  const broken = createHealth({ demoId: 'agent-audit-trail-lab', demoName: 'Agent Audit Trail LAB', version: '0.1.0', runChecks: () => [{ id: 'x', level: 'fail', detail: '' }], allPassed: (cs) => (cs || []).every((x) => x?.level !== 'fail'), intervalMs: 1e9 });
  const throwing = createHealth({ demoId: 'agent-audit-trail-lab', demoName: 'Agent Audit Trail LAB', version: '0.1.0', runChecks: () => { throw new Error('boom'); }, allPassed: (cs) => (cs || []).every((x) => x?.level !== 'fail'), intervalMs: 1e9 });
  const get = (h) => new Promise((resolve) => { h.router.handle({ method: 'GET', url: '/', headers: {} }, { set() {}, json: resolve }, () => {}); });
  return Promise.all([get(ok), get(broken), get(throwing)]).then(([a, b, c]) => {
    assert.equal(a.schema, 'demo-health/1'); assert.equal(a.state, 'ready'); assert.equal(a.runtime, 'offline'); assert.equal(a.demo.id, 'agent-audit-trail-lab');
    assert.equal(b.state, 'broken'); assert.equal(c.state, 'unknown');
    ok.stop(); broken.stop(); throwing.stop();
  });
});

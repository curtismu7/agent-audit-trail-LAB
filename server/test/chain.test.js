import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GENESIS, TAMPER_KINDS, createChain } from '../src/chain.js';

const key = Buffer.alloc(32, 3);
const make = (n = 6, opts = {}) => {
  const c = createChain({ key, now: () => new Date('2026-01-01T00:00:00Z'), ...opts });
  for (let i = 1; i <= n; i++) c.append({ id: `ev-${i}`, actor: 'agent-real', n: i });
  return c;
};

test('an untouched chain verifies and links each entry to the previous hash', () => {
  const c = make();
  const v = c.verify();
  assert.equal(v.ok, true); assert.equal(v.length, 6); assert.equal(v.headSeq, 6);
  const list = c.list();
  assert.equal(list[0].prevHash, GENESIS);
  for (let i = 1; i < list.length; i++) assert.equal(list[i].prevHash, list[i - 1].hash);
});

test('entries are deeply frozen: a stored event cannot be edited in place', () => {
  const c = make();
  assert.throws(() => { c.list()[2].event.actor = 'agent-forged'; }, TypeError);
  assert.throws(() => { c.list()[2].hash = 'x'; }, TypeError);
});

test('every tamper kind is detected on a copy and the live store is untouched', () => {
  const c = make(8);
  for (const kind of TAMPER_KINDS) {
    const r = c.tamperDemo(kind, 4);
    assert.equal(r.before.ok, true, kind);
    assert.equal(r.after.ok, false, `${kind} must be detected`);
    assert.ok(r.after.reason, kind);
    assert.equal(r.realStoreTouched, false);
    assert.equal(c.verify().ok, true, `${kind}: live chain still verifies`);
  }
});

test('edit is caught at the edited entry with hash_mismatch', () => {
  const r = make(8).tamperDemo('edit', 4);
  assert.equal(r.after.firstBadSeq, 4); assert.equal(r.after.reason, 'hash_mismatch');
});

test('edit-and-rehash with a plain hash still fails: the HMAC key is what a forger lacks', () => {
  const r = make(8).tamperDemo('edit-and-rehash', 4);
  assert.equal(r.after.ok, false); assert.equal(r.after.firstBadSeq, 4); assert.equal(r.after.reason, 'hash_mismatch');
});

test('delete, insert and reorder break the sequence; truncating the tail is caught only by the head checkpoint', () => {
  const c = make(8);
  assert.equal(c.tamperDemo('delete', 4).after.reason, 'sequence_gap');
  assert.equal(c.tamperDemo('insert', 4).after.ok, false);
  assert.equal(c.tamperDemo('reorder', 4).after.reason, 'sequence_gap');
  const t = c.tamperDemo('truncate');
  assert.equal(t.after.reason, 'truncated_or_head_mismatch');
  // Without a checkpoint the shortened chain looks fine: this is why one is kept outside the entries.
  const copy = c.snapshot(); copy.pop();
  assert.equal(c.verifyEntries(copy, { seq: copy.length, hash: copy.at(-1).hash }).ok, true);
});

test('a different HMAC key cannot produce an entry the real chain accepts', () => {
  const real = make(4); const forger = createChain({ key: Buffer.alloc(32, 9), now: () => new Date('2026-01-01T00:00:00Z') });
  for (let i = 1; i <= 4; i++) forger.append({ id: `ev-${i}`, actor: 'agent-real', n: i });
  assert.equal(real.verifyEntries(forger.snapshot(), forger.head).ok, false);
});

test('a malformed entry is reported, not thrown', () => {
  const c = make(3); const copy = c.snapshot();
  copy[1] = { seq: 2 };
  assert.equal(c.verifyEntries(copy).reason, 'malformed_entry');
  assert.equal(c.verifyEntries([null]).ok, false);
});

test('the cap refuses further appends instead of dropping history', () => {
  const c = make(3, { cap: 3 });
  assert.throws(() => c.append({ id: 'ev-4' }), (e) => e.code === 'store_full');
  assert.equal(c.verify().ok, true); assert.equal(c.size, 3);
});

test('tamperDemo validates its inputs', () => {
  assert.equal(make(8).tamperDemo('nope').error, 'unknown_kind');
  assert.equal(make(2).tamperDemo('edit').error, 'not_enough_entries');
  assert.equal(make(8).tamperDemo('edit', 9999).after.ok, false, 'an out-of-range seq is clamped to the last entry');
});

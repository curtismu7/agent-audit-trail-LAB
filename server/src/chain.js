// Append-only, tamper-evident hash chain over the audit store.
//  - Entries are only ever appended. Nothing in the API can update or delete one.
//  - entry.hash = HMAC-SHA256(key, canonical JSON of {seq, at, event, prevHash}); prevHash is the previous entry's hash.
//    The key is random per process and never leaves it, so an attacker who edits an entry and re-hashes the chain
//    with a plain SHA-256 still fails verification.
//  - Truncation (dropping the newest entries) leaves a valid-looking chain, so verify also compares the last entry
//    with a separately held head checkpoint {seq, hash}. In production that checkpoint would live somewhere the
//    store's writer cannot rewrite (a different system, a signed log). Here it is a variable beside the array.
//  - Capped: at the cap, append is refused (store_full). Nothing is dropped, so the chain is never re-anchored.
import crypto from 'node:crypto';

export const GENESIS = '0'.repeat(64);
export const CHAIN_CAP = 2000;

export const canonical = (v) => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
};

export const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
};

export function createChain({ key = crypto.randomBytes(32), now = () => new Date(), cap = CHAIN_CAP } = {}) {
  const entries = [];
  let head = { seq: 0, hash: GENESIS };
  const mac = (e) => crypto.createHmac('sha256', key).update(canonical({ seq: e.seq, at: e.at, event: e.event, prevHash: e.prevHash })).digest('hex');

  // Pure: verifies any list of entries (the live one or a tampered copy) against the key and a head checkpoint.
  function verifyEntries(list, checkpoint = head) {
    let prev = GENESIS;
    let expectSeq = 1;
    for (const e of list) {
      if (!e || typeof e !== 'object' || typeof e.hash !== 'string') return { ok: false, length: list.length, firstBadSeq: e?.seq ?? expectSeq, reason: 'malformed_entry' };
      if (e.seq !== expectSeq) return { ok: false, length: list.length, firstBadSeq: e.seq, reason: 'sequence_gap' };
      if (e.prevHash !== prev) return { ok: false, length: list.length, firstBadSeq: e.seq, reason: 'chain_broken' };
      let expected;
      try { expected = mac(e); } catch { return { ok: false, length: list.length, firstBadSeq: e.seq, reason: 'malformed_entry' }; }
      const a = Buffer.from(e.hash); const b = Buffer.from(expected);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, length: list.length, firstBadSeq: e.seq, reason: 'hash_mismatch' };
      prev = e.hash;
      expectSeq += 1;
    }
    if (checkpoint.seq !== expectSeq - 1 || checkpoint.hash !== prev) {
      return { ok: false, length: list.length, firstBadSeq: expectSeq, reason: 'truncated_or_head_mismatch' };
    }
    return { ok: true, length: list.length, headSeq: checkpoint.seq, headHash: prev, reason: null };
  }

  function append(event) {
    if (entries.length >= cap) throw Object.assign(new Error('the audit store is full; POST /api/reset starts a new one'), { code: 'store_full' });
    const entry = { seq: head.seq + 1, at: now().toISOString(), event: structuredClone(event), prevHash: head.hash };
    entry.hash = mac(entry);
    deepFreeze(entry);
    entries.push(entry);
    head = { seq: entry.seq, hash: entry.hash };
    return entry;
  }

  const snapshot = () => structuredClone(entries); // unfrozen deep copy, for tamper demos and tests
  const sha256Chain = (e) => crypto.createHash('sha256').update(canonical({ seq: e.seq, at: e.at, event: e.event, prevHash: e.prevHash })).digest('hex');

  // Tamper demo on a COPY. The live store is never touched. Returns what changed and what verify says about the copy.
  function tamperDemo(kind = 'edit', seq) {
    const before = verifyEntries(entries);
    const copy = snapshot();
    if (copy.length < 3) return { error: 'not_enough_entries' };
    const idx = Math.min(Math.max(Number.isInteger(seq) ? seq - 1 : Math.floor(copy.length / 2), 0), copy.length - 1);
    const target = copy[idx];
    let change;
    const rehashFrom = (i) => { for (let j = i; j < copy.length; j++) { if (j > 0) copy[j].prevHash = copy[j - 1].hash; copy[j].hash = sha256Chain(copy[j]); } };
    switch (kind) {
      case 'edit':
        change = { seq: target.seq, field: 'event.actor', from: target.event.actor, to: 'agent-forged' };
        target.event.actor = 'agent-forged';
        break;
      case 'edit-timestamp':
        change = { seq: target.seq, field: 'at', from: target.at, to: new Date(Date.parse(target.at) - 86_400_000).toISOString(), note: 'only the recorded time was moved back one day' };
        target.at = change.to;
        break;
      case 'edit-and-rehash':
        change = { seq: target.seq, field: 'event.actor', from: target.event.actor, to: 'agent-forged', note: 'every later hash was recomputed with plain SHA-256; without the HMAC key it still fails' };
        target.event.actor = 'agent-forged';
        rehashFrom(idx);
        break;
      case 'delete':
        change = { seq: target.seq, field: '(entry)', from: 'present', to: 'removed' };
        copy.splice(idx, 1);
        break;
      case 'insert':
        change = { seq: target.seq, field: '(entry)', from: 'absent', to: 'a forged copy inserted after this entry' };
        copy.splice(idx + 1, 0, { ...structuredClone(target), event: { ...structuredClone(target.event), actor: 'agent-forged' } });
        break;
      case 'reorder':
        change = { seq: target.seq, field: '(order)', from: `position ${idx + 1}`, to: `swapped with position ${Math.min(idx + 2, copy.length)}` };
        if (idx + 1 < copy.length) [copy[idx], copy[idx + 1]] = [copy[idx + 1], copy[idx]]; else [copy[idx], copy[idx - 1]] = [copy[idx - 1], copy[idx]];
        break;
      case 'truncate':
        change = { seq: copy[copy.length - 1].seq, field: '(tail)', from: 'present', to: 'newest entry removed; only the head checkpoint can tell' };
        copy.pop();
        break;
      default:
        return { error: 'unknown_kind' };
    }
    return { kind, change, before, after: verifyEntries(copy), realStoreTouched: false };
  }

  return {
    append, verify: () => verifyEntries(entries), verifyEntries, tamperDemo, snapshot,
    list: () => entries, get size() { return entries.length; }, get head() { return { ...head }; }, cap,
  };
}
export const TAMPER_KINDS = ['edit', 'edit-timestamp', 'edit-and-rehash', 'delete', 'insert', 'reorder', 'truncate'];

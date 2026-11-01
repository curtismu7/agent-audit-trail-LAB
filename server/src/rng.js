// Seeded, deterministic pseudo-random numbers (mulberry32). Same seed and same call order give the same ids,
// so the synthetic events are reproducible. Not for security: the hash chain uses an HMAC key, not this.
export function createRng(seed = 1) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const hex = (n) => {
    let s = '';
    while (s.length < n) s += Math.floor(next() * 16).toString(16);
    return /^0+$/.test(s) ? `${s.slice(0, -1)}1` : s; // W3C trace/span ids must not be all zero
  };
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  return { next, hex, int };
}

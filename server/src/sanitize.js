// Every string that came from an event source is untrusted data. These helpers make it inert: control and invisible
// characters are shown as [U+XXXX], and size is bounded. They run when an event is normalized, before it is stored.

// Zero-width, bidi controls, soft hyphen, filler characters, variation selectors (not the emoji ones FE0E/FE0F),
// Braille blank, byte-order mark, line/paragraph separators, musical formatting characters, lone surrogates and the
// Unicode tag block.
export const RANGES = [[0xAD], [0x34F], [0x61C], [0x115F, 0x1160], [0x17B4, 0x17B5], [0x180B, 0x180F], [0x200B, 0x200F], [0x202A, 0x202E],
  [0x2060, 0x206F], [0x2800], [0x3164], [0xFE00, 0xFE0D], [0xFEFF], [0xFFA0], [0xFFF9, 0xFFFB], [0x2028, 0x2029], [0x1D173, 0x1D17A],
  [0xD800, 0xDFFF], [0xE0000, 0xE007F], [0xE0100, 0xE01EF]];
const hexEsc = (n) => `\\u{${n.toString(16)}}`;
export const INVISIBLE = new RegExp(`[${RANGES.map(([a, b]) => (b === undefined ? hexEsc(a) : `${hexEsc(a)}-${hexEsc(b)}`)).join('')}]`, 'u');
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;
const UNSAFE_G = new RegExp(`${INVISIBLE.source}|${CONTROL.source}`, 'gu');

export const hasUnsafe = (s) => INVISIBLE.test(String(s)) || CONTROL.test(String(s));

export function revealText(value, max = 500) {
  const s = String(value ?? '').replace(UNSAFE_G, (ch) => `[U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}]`);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// Deep copy with every string revealed and bounded; depth, array and key counts capped. Iterative-safe by depth limit.
// `seen.hidden` is set when any string needed revealing.
export function inertValue(value, seen = { hidden: false }, depth = 0) {
  if (typeof value === 'string') { if (hasUnsafe(value)) seen.hidden = true; return revealText(value); }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (depth >= 6) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => inertValue(v, seen, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 50).map(([k, v]) => {
      if (hasUnsafe(k)) seen.hidden = true;
      return [revealText(k, 128), inertValue(v, seen, depth + 1)];
    }));
  }
  return undefined;
}

// Deployment configuration: the mode setting (rule 1) and the customer branding / vocabulary file (rule 12).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_VERTICAL, castFor } from './cast.js';
import { hasUnsafe } from './sanitize.js';

export const DEFAULT_CUSTOMER_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../customer.config.json');
export const DEFAULT_CUSTOMER = Object.freeze({
  brand: Object.freeze({ title: 'Agent Audit Trail', tagline: 'Who did what, through which agent' }),
  vocabulary: Object.freeze({ agent: 'agent', human: 'human' }),
  vertical: DEFAULT_VERTICAL,
});

// AAT_LAB_MODE is the mode the page opens in. Only mock exists: this app has no live audit source to talk to, so asking for live is an
// honest refusal, never a silent fallback. A bare MODE is NOT read: the shared settings file is read by every standalone app, and another
// app's MODE must not switch this one.
export const MODES = ['mock', 'live'];
export const LIVE_REFUSAL = 'Live mode is not available in this app: it has no live audit source to connect to, and everything shown is a seeded mock. The page stays in mock mode.';
export function modeFrom(env = process.env) {
  const raw = env.AAT_LAB_MODE;
  const m = raw === undefined || raw === '' ? 'mock' : raw;
  if (m === 'live') throw new Error(LIVE_REFUSAL);
  if (m !== 'mock') throw new Error(`AAT_LAB_MODE=${String(m).slice(0, 20)} is not available: this app has a mock mode only`);
  return m;
}

const label = (v, fallback, max = 60) => (typeof v === 'string' && v.trim() !== '' && v.length <= max && !hasUnsafe(v) && !/[<>{}]/.test(v) ? v.trim() : fallback);

// Validate a parsed customer config: unknown keys are ignored, bad values fall back to the defaults, strings are bounded
// plain text. The file only ever relabels the UI; it cannot change behaviour.
export function normalizeCustomer(raw) {
  const o = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const brand = o.brand ?? {}; const vocab = o.vocabulary ?? {};
  return {
    brand: { title: label(brand.title, DEFAULT_CUSTOMER.brand.title), tagline: label(brand.tagline, DEFAULT_CUSTOMER.brand.tagline, 120) },
    vocabulary: { agent: label(vocab.agent, DEFAULT_CUSTOMER.vocabulary.agent, 30), human: label(vocab.human, DEFAULT_CUSTOMER.vocabulary.human, 30) },
    vertical: typeof o.vertical === 'string' && castFor(o.vertical) ? o.vertical : DEFAULT_CUSTOMER.vertical,
  };
}

export function loadCustomer(file = DEFAULT_CUSTOMER_FILE) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    if (text.length > 4096) return normalizeCustomer(null);
    return normalizeCustomer(JSON.parse(text));
  } catch { return normalizeCustomer(null); }
}

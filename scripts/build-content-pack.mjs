#!/usr/bin/env node
/**
 * Generates content-pack.json (repo root). Format: docs/content-pack.schema.json (a copy of the Learning Hub kit schema).
 * Glossary from content/terms.json, stories from content/stories.json (same text as web/src/components/Story.jsx; a test checks that),
 * cards for the UI views. Deterministic: lists sorted by id, 2-space JSON, no timestamps. The git commit is recorded only when
 * passed (--commit=<sha>), so a plain run is reproducible.
 *
 * Sources: none. No public documentation URL is cited in this repo that was verified, so the pack lists none.
 *
 *   node scripts/build-content-pack.mjs [--commit=<sha>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PACK_PATH = path.join(ROOT, 'content-pack.json');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// The UI has tabs and no deep links, so every card opens the app root.
const CARDS = [
  { id: 'who-did-what', label: 'Who did what, through which agent', description: 'Run a scenario and read the one-sentence answer, the delegation chain and the facts with their evidence.', group: 'try-it', href: '/', terms: ['audit-trail', 'join', 'act-claim', 'token-exchange'], story: 'S05' },
  { id: 'gaps-and-orphans', label: 'Gaps and orphaned events', description: 'Run the orphaned and two-hop scenarios and see what is missing shown, not guessed.', group: 'try-it', href: '/', terms: ['gap', 'orphaned-event', 'correlation-id', 'traceparent'], story: 'S02' },
  { id: 'retention', label: 'The retention trap', description: 'Ask for 30 days and watch the naive upstream answer silently empty while the audit tool clamps and says so.', group: 'try-it', href: '/', terms: ['retention-clamp', 'silent-empty'], story: 'S04' },
  { id: 'tamper', label: 'Tamper with the record', description: 'Edit, delete, insert, reorder, truncate or change a timestamp on a copy and watch verification fail.', group: 'try-it', href: '/', terms: ['hash-chain'], story: 'S03' },
  { id: 'tools', label: 'The three read-only tools', description: 'Call the MCP-style endpoint and see that no write tool exists.', group: 'concept', href: '/', terms: ['read-only-tools', 'inert-text'], story: 'S04' },
  { id: 'audit-flow', label: 'Audit flow', description: 'Event sources, normalizer, store, audit tools and join as a movable diagram (diagram-studio/1 data) with Simulate.', group: 'concept', href: '/', terms: ['demo-mode', 'audit-trail'], story: 'S01' },
];

export function buildPack({ commit } = {}) {
  const pkg = readJson('package.json');
  const stories = readJson('content/stories.json').sort(byId);
  const ids = new Set(stories.map((s) => s.id));
  const pack = {
    schema: 'demo-content-pack/1',
    id: 'agent-audit-trail-lab',
    title: 'Agent Audit Trail LAB',
    version: pkg.version,
    ...(commit ? { source: { repo: 'agent-audit-trail-LAB', commit } } : {}),
    demo: { id: 'agent-audit-trail-lab', name: 'Agent Audit Trail LAB', catalog: 'D17', baseUrl: 'http://localhost:6600', doctor: '/api/health', tags: ['audit-trail', 'correlation', 'delegation', 'hash-chain'] },
    glossary: readJson('content/terms.json').sort(byId),
    sources: [],
    cards: CARDS.map(({ href, ...c }) => ({ ...c, action: { type: 'route', href } })).sort(byId),
    diagrams: [{ id: 'audit-flow', label: 'Audit flow', href: '/' }],
    stories,
  };
  for (const c of pack.cards) if (c.story && !ids.has(c.story)) throw new Error(`card ${c.id} names unknown story ${c.story}`);
  return pack;
}

export const serialize = (pack) => `${JSON.stringify(pack, null, 2)}\n`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const commit = process.argv.find((a) => a.startsWith('--commit='))?.slice(9);
  fs.writeFileSync(PACK_PATH, serialize(buildPack({ commit })));
  console.log(`wrote ${path.relative(process.cwd(), PACK_PATH) || PACK_PATH}`);
}

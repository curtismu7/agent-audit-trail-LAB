#!/usr/bin/env node
// Validates content-pack.json against docs/content-pack.schema.json with ajv, and checks the cross-references the schema
// cannot: every card's terms are glossary ids and every card's story is in stories[].
//   node scripts/validate-content-pack.mjs [path/to/content-pack.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function validatePack(pack, schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/content-pack.schema.json'), 'utf8'))) {
  const validate = new Ajv({ allErrors: true, strict: true, validateFormats: false }).compile(schema);
  const errors = validate(pack) ? [] : validate.errors.map((e) => `${e.instancePath || '/'} ${e.message}`);
  const terms = new Set((pack.glossary || []).map((g) => g.id));
  const stories = new Set((pack.stories || []).map((s) => s.id));
  for (const c of pack.cards || []) {
    for (const t of c.terms || []) if (!terms.has(t)) errors.push(`card ${c.id}: unknown term ${t}`);
    if (c.story && !stories.has(c.story)) errors.push(`card ${c.id}: unknown story ${c.story}`);
  }
  // Rules the schema cannot express (the Learning Hub loader checks these too).
  const ids = (label, list) => { const seen = new Set(); for (const x of list || []) { if (!/^[A-Za-z0-9_-]{1,81}$/.test(x.id || '')) errors.push(`${label} id "${x.id}": only [A-Za-z0-9_-], at most 81 characters, no dot`); if (seen.has(x.id)) errors.push(`${label} id "${x.id}": duplicate`); seen.add(x.id); } };
  ids('glossary', pack.glossary); ids('card', pack.cards); ids('story', pack.stories);
  const walk = (v, at) => {
    if (typeof v === 'string') {
      if (v.length > 8000) errors.push(`${at}: string over 8000 characters`);
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)) errors.push(`${at}: control character`);
      if (/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/.test(v)) errors.push(`${at}: JWT-shaped value`);
      if (/^\s*(javascript|data):/i.test(v) && /(^|\.)(href|url|baseUrl)$/.test(at)) errors.push(`${at}: unsafe link`);
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${at}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, at ? `${at}.${k}` : k);
  };
  walk(pack, '');
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] || path.join(ROOT, 'content-pack.json');
  const errors = validatePack(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log(`${file}: valid`);
}

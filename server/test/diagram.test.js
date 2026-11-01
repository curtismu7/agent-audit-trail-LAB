import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { DIAGRAM_NAMES, hasDiagram, loadDiagram, rawDiagram } from '../src/diagramData.js';
import { validateDiagram } from '../src/diagramStudioValidate.js';
import { boot, request } from './helpers.js';

const root = path.resolve(import.meta.dirname, '../..');

test('every diagram file is diagram-studio/1 data, loaded by name, and every file in server/diagrams is named', () => {
  const files = fs.readdirSync(path.join(root, 'server/diagrams')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
  assert.deepEqual([...DIAGRAM_NAMES].sort(), files);
  for (const n of DIAGRAM_NAMES) { assert.deepEqual(validateDiagram(loadDiagram(n)), [], n); assert.equal(rawDiagram(n).schema, 'diagram-studio/1'); }
  assert.equal(hasDiagram('audit-flow'), true);
  for (const bad of ['nope', '__proto__', 'constructor', '../x', 5, undefined]) assert.equal(hasDiagram(bad), false, String(bad));
});

test('the validator copy rejects a broken diagram', () => {
  const d = structuredClone(rawDiagram('audit-flow'));
  d.edges[0].target = 'nowhere'; d.steps[1].edges = [99]; delete d.title;
  assert.ok(validateDiagram(d).length >= 3);
});

test('the diagram steps say what the Story strip and the content pack stories say', () => {
  const stories = JSON.parse(fs.readFileSync(path.join(root, 'content/stories.json'), 'utf8'));
  const d = rawDiagram('audit-flow');
  assert.equal(d.steps.length, stories.length);
  d.steps.forEach((s, i) => { assert.equal(s.title, stories[i].title); assert.equal(s.what, stories[i].say); });
});

test('GET /api/diagram serves the data by name; unknown names are 404 and extra keys are 400', async () => {
  const s = await boot('diagram');
  try {
    const ok = await request(s.port, 'GET', '/api/diagram');
    assert.equal(ok.status, 200); assert.deepEqual(ok.json.names, DIAGRAM_NAMES); assert.equal(ok.json.diagram.id, 'audit-flow');
    assert.equal((await request(s.port, 'GET', '/api/diagram?name=audit-flow')).status, 200);
    for (const q of ['name=nope', 'name=__proto__', 'name=..%2fapp']) assert.equal((await request(s.port, 'GET', `/api/diagram?${q}`)).status, 404, q);
    for (const q of ['x=1', 'name=audit-flow&x=1', 'name[]=a']) assert.equal((await request(s.port, 'GET', `/api/diagram?${q}`)).status, 400, q);
    assert.equal((await request(s.port, 'POST', '/api/diagram', { body: {} })).status, 405);
  } finally { await s.close(); }
});

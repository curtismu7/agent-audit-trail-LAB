// AirGuard Airlines (a fictional airline) is the default story. These tests fail on the old retail default.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { CAST, DEFAULT_VERTICAL, PACKS, castFor, resolveTokens, tokensIn } from '../src/cast.js';
import { DEFAULT_CUSTOMER, normalizeCustomer } from '../src/config.js';
import { createRuntime } from '../src/runtime.js';
import { SCENARIOS } from '../src/scenarios.js';
import { NOW } from './helpers.js';

// Brand names and retail/finance/health wording the airline run must never show. "Meridian Air" and the older
// airline brands are retired names; the others are the other packs' own words.
const RETIRED = /Meridian Air|Skyline Air|Northwind|Meridian Journeys|Contoso|Tessera Travel|AeroGuard|Fabrikam|Harbor|Vellum/i;
const OTHER_PACKS = /Alice Example|Bao Sample|Carla Placeholder|Dmitri Approver|Olga Operator|Purchasing Agent|Trip Orchestrator|Booking Sub-agent|Build Bot|Research Agent|Shop Web App|Travel Web App|purchase\.create|catalog\.search|travel\.book|ci\.trigger|purchase:write|catalog:read|travel:book|ci:run|purchase-limits|travel-rules|\/mcp\/(shop|travel|ci)\b|shop\.example|travel\.example|ci\.example|\bretail\b|\bcatalog\b|\bbank|\bclinic|\bpatient|\bprescription/i;

const airlineRun = () => {
  const rt = createRuntime({ now: () => NOW });
  const parts = [JSON.stringify(rt.scenarios())];
  for (const id of SCENARIOS.map((s) => s.id)) {
    const run = rt.runScenario(id);
    parts.push(JSON.stringify(rt.store.all()));
    if (run.traceId) parts.push(rt.join.byTrace(run.traceId).sentence);
  }
  return { rt, text: parts.join('\n') };
};

test('AIRLINE DEFAULT: the default vertical, the config default and a fresh runtime are all airlines', () => {
  assert.equal(DEFAULT_VERTICAL, 'airlines');
  assert.equal(DEFAULT_CUSTOMER.vertical, 'airlines');
  assert.equal(CAST, PACKS.airlines);
  const rt = createRuntime({ now: () => NOW });
  assert.equal(rt.vertical, 'airlines');
  assert.equal(castFor().users.alice.name, 'Emma Hartley');
  assert.match(rt.scenarios()[0].story, /AirGuard Airlines/, 'the first story on the default page names the airline');
});

test('AIRLINE DEFAULT: the seeded run shows AirGuard Airlines and no retail, retired or other-pack wording', () => {
  const { rt, text } = airlineRun();
  assert.match(text, /AirGuard Airlines/);
  assert.match(text, /Emma Hartley/); assert.match(text, /issue_refund/); assert.match(text, /get_itinerary/); assert.match(text, /request_rebooking/);
  assert.doesNotMatch(text, RETIRED);
  assert.doesNotMatch(text, OTHER_PACKS);
  // The seeded store (the default page) is airline too, including the background sign-ins.
  assert.doesNotMatch(JSON.stringify(rt.store.all()), RETIRED);
  assert.doesNotMatch(JSON.stringify(rt.store.all()), OTHER_PACKS);
});

test('AIRLINE DEFAULT: every host is .example, the brand is the only airline brand', () => {
  const hosts = [...JSON.stringify(PACKS.airlines).matchAll(/https?:\/\/([a-z0-9.-]+)/g)].map((m) => m[1]);
  assert.ok(hosts.length > 0);
  for (const h of hosts) assert.match(h, /\.example$/, h);
  assert.doesNotMatch(JSON.stringify(PACKS.airlines), RETIRED);
});

test('AIRLINE PACK: same shape as the other packs, every story token resolves, an undefined token fails', () => {
  const shape = (o) => Object.keys(o).sort().map((k) => (o[k] !== null && typeof o[k] === 'object' ? `${k}:{${shape(o[k])}}` : k)).join(',');
  for (const name of ['retail', 'banking', 'healthcare']) assert.equal(shape(PACKS.airlines), shape(PACKS[name]), name);
  for (const s of SCENARIOS) {
    for (const t of tokensIn(s.story)) assert.equal(typeof resolveTokens(`{{${t}}}`, PACKS.airlines), 'string', `${s.id} ${t}`);
  }
  assert.throws(() => resolveTokens('{{tools.refund.name}}', PACKS.airlines), /undefined story token/);
  assert.throws(() => resolveTokens('{{users.nobody.name}}', PACKS.airlines), /undefined story token/);
});

test('OLDER PACKS: selecting retail by config or reset still renders retail names and no airline names', () => {
  for (const [name, who, tool] of [['retail', 'Alice Example', 'purchase.create'], ['banking', 'Anya Ledger', 'payment.create'], ['healthcare', 'Ines Patient', 'prescription.refill']]) {
    const rt = createRuntime({ now: () => NOW, vertical: name });
    const run = rt.runScenario('normal-purchase');
    const j = rt.join.byTrace(run.traceId);
    assert.match(j.sentence, new RegExp(who)); assert.match(j.sentence, new RegExp(tool.replace('.', '\\.')));
    assert.doesNotMatch(JSON.stringify(rt.store.all()), /AirGuard|issue_refund|Emma Hartley/, name);
  }
  const rt = createRuntime({ now: () => NOW });
  rt.reset({ vertical: 'retail' });
  assert.equal(rt.vertical, 'retail');
});

test('UNKNOWN VERTICAL: a saved config with an unknown id falls back to airlines and does not crash', () => {
  for (const bad of ['nope', '__proto__', 'constructor', 5, null]) assert.equal(normalizeCustomer({ vertical: bad }).vertical, 'airlines');
  assert.equal(normalizeCustomer({ vertical: 'finance' }).vertical, 'airlines', 'the old id from the spec text is not a pack here');
  assert.throws(() => createRuntime({ vertical: 'nope' }), /unknown vertical/);
});

test('SHIPPED CONFIG: customer.config.example.json names the airline default', () => {
  const ex = JSON.parse(fs.readFileSync(new URL('../../customer.config.example.json', import.meta.url), 'utf8'));
  assert.equal(ex.vertical, 'airlines');
});

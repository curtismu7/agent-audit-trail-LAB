// The fictional cast. Every name, id and host here is invented; hosts are .example only.
// Stories (scenarios.js) refer to these through {{path.to.value}} tokens; an undefined token is an error.
const RETAIL = {
  users: {
    alice: { id: 'user-alice', name: 'Alice Example' },
    bao: { id: 'user-bao', name: 'Bao Sample' },
    carla: { id: 'user-carla', name: 'Carla Placeholder' },
    dmitri: { id: 'user-dmitri', name: 'Dmitri Approver' },
    olga: { id: 'user-olga', name: 'Olga Operator' },
  },
  agents: {
    purchasing: { id: 'agent-purchasing', name: 'Purchasing Agent' },
    orchestrator: { id: 'agent-orchestrator', name: 'Trip Orchestrator' },
    booking: { id: 'agent-booking', name: 'Booking Sub-agent' },
    buildbot: { id: 'agent-build-bot', name: 'Build Bot' },
    researcher: { id: 'agent-researcher', name: 'Research Agent' },
  },
  apps: {
    shop: { id: 'client-shop-web', name: 'Shop Web App' },
    travel: { id: 'client-travel-web', name: 'Travel Web App' },
  },
  tools: {
    purchase: { name: 'purchase.create', resource: 'https://shop.example/api/orders', scope: 'purchase:write' },
    lookup: { name: 'catalog.search', resource: 'https://shop.example/api/catalog', scope: 'catalog:read' },
    book: { name: 'travel.book', resource: 'https://travel.example/api/bookings', scope: 'travel:book' },
    deploy: { name: 'ci.trigger', resource: 'https://ci.example/api/builds', scope: 'ci:run' },
  },
  hosts: { gateway: 'gateway.example', idp: 'idp.example', policy: 'policy.example' },
};

const user = (slug, name) => ({ id: `user-${slug}`, name });
const BANKING = {
  users: { alice: user('anya', 'Anya Ledger'), bao: user('bruno', 'Bruno Vault'), carla: user('celine', 'Celine Interest'), dmitri: user('dario', 'Dario Compliance'), olga: user('orla', 'Orla Operations') },
  agents: {
    purchasing: { id: 'agent-payments', name: 'Payments Agent' }, orchestrator: { id: 'agent-treasury', name: 'Treasury Orchestrator' },
    booking: { id: 'agent-settlement', name: 'Settlement Sub-agent' }, buildbot: { id: 'agent-report-bot', name: 'Report Bot' }, researcher: { id: 'agent-analyst', name: 'Account Analyst' },
  },
  apps: { shop: { id: 'client-bank-web', name: 'Retail Banking App' }, travel: { id: 'client-treasury-web', name: 'Treasury Portal' } },
  tools: {
    purchase: { name: 'payment.create', resource: 'https://bank.example/api/payments', scope: 'payments:write' },
    lookup: { name: 'accounts.search', resource: 'https://bank.example/api/accounts', scope: 'accounts:read' },
    book: { name: 'transfer.schedule', resource: 'https://bank.example/api/transfers', scope: 'transfers:write' },
    deploy: { name: 'report.run', resource: 'https://reports.example/api/jobs', scope: 'reports:run' },
  },
  hosts: { gateway: 'gateway.example', idp: 'idp.example', policy: 'policy.example' },
};
const HEALTH = {
  users: { alice: user('ines', 'Ines Patient'), bao: user('bastian', 'Bastian Sample'), carla: user('clara', 'Clara Placeholder'), dmitri: user('daniel', 'Daniel Clinician'), olga: user('olive', 'Olive Operator') },
  agents: {
    purchasing: { id: 'agent-pharmacy', name: 'Pharmacy Agent' }, orchestrator: { id: 'agent-care-plan', name: 'Care Plan Orchestrator' },
    booking: { id: 'agent-scheduler', name: 'Appointment Sub-agent' }, buildbot: { id: 'agent-export-bot', name: 'Export Bot' }, researcher: { id: 'agent-triage', name: 'Triage Agent' },
  },
  apps: { shop: { id: 'client-patient-web', name: 'Patient Portal' }, travel: { id: 'client-clinic-web', name: 'Clinic Portal' } },
  tools: {
    purchase: { name: 'prescription.refill', resource: 'https://clinic.example/api/refills', scope: 'refills:write' },
    lookup: { name: 'records.search', resource: 'https://clinic.example/api/records', scope: 'records:read' },
    book: { name: 'appointment.book', resource: 'https://clinic.example/api/appointments', scope: 'appointments:write' },
    deploy: { name: 'export.run', resource: 'https://exports.example/api/jobs', scope: 'exports:run' },
  },
  hosts: { gateway: 'gateway.example', idp: 'idp.example', policy: 'policy.example' },
};

// Three vertical packs with the same shape: stories refer to {{users.alice.name}} and so on, and each pack fills them in
// with its own fictional people, agents and tools. Every pack must define every token a story uses (a test checks it).
export const PACKS = { retail: RETAIL, banking: BANKING, healthcare: HEALTH };
export const DEFAULT_VERTICAL = 'retail';
export const CAST = RETAIL;
export const castFor = (vertical = DEFAULT_VERTICAL) => (Object.hasOwn(PACKS, vertical) ? PACKS[vertical] : null);

const lookup = (path, cast) => path.split('.').reduce((o, k) => (o !== null && typeof o === 'object' && Object.hasOwn(o, k) ? o[k] : undefined), cast);

// Replace {{a.b.c}} with the cast value. Throws on an undefined token or a non-string value: a story can never
// show a placeholder to the audience.
export function resolveTokens(text, cast = CAST) {
  return String(text).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, p) => {
    const v = lookup(p, cast);
    if (typeof v !== 'string') throw new Error(`undefined story token {{${p}}}`);
    return v;
  });
}
export const tokensIn = (text) => [...String(text).matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]);

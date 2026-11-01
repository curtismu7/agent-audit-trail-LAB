// Scenarios as data. Each has a story with {{cast}} tokens (cast.js) and a builder that emits raw events from the six
// sources, deterministically from the seeded rng. resolveTokens throws on an undefined token, so a typo in a story
// fails a test instead of reaching the audience.
//
// The builders only create raw events. The normalizer and the store treat them like any other input.
import { CAST, resolveTokens } from './cast.js';
import { gatewayLog, hitlEvent, idpSignin, killEvent, policyDecision, tokenEvent } from './sources.js';

const ZWSP = String.fromCharCode(0x200B); // a zero-width space, hidden on purpose in the orphan scenario

// A tiny helper bundle for one scenario instance.
function ctx(rng, start) {
  const events = [];
  const at = (ms) => new Date(start.getTime() + ms);
  const trace = { traceId: rng.hex(32), spanId: rng.hex(16) };
  const span = () => ({ traceId: trace.traceId, spanId: rng.hex(16) });
  return {
    events, at, trace, span, sid: `sid-${rng.hex(12)}`, id: (p) => `${p}-${rng.hex(10)}`, jti: () => rng.hex(16),
    push: (e) => { events.push(e); return e; },
  };
}

const signinAndIssue = (c, user, app, scope, aud) => {
  c.push(idpSignin({ id: c.id('act'), at: c.at(0), user, client: app, sid: c.sid, resource: app.name }));
  c.push(tokenEvent({ id: c.id('tok'), at: c.at(20_000), kind: 'token.issued', sub: user.id, clientId: app.id, clientName: app.name, aud, scope, sid: c.sid, jti: c.jti() }));
};

const ing = (store, made) => store.ingest(made.source, made.raw);

// Builders take the cast of the chosen vertical pack: `({ users, agents, apps, tools })`.
const BUILDERS = {
  'normal-purchase'(rng, start, { users, agents, apps, tools }) {
    const c = ctx(rng, start); const u = users.alice; const a = agents.purchasing; const tl = tools.purchase;
    signinAndIssue(c, u, apps.shop, ['openid', tl.scope], 'https://gateway.example');
    c.push(tokenEvent({ id: c.id('tok'), at: c.at(40_000), kind: 'token.exchanged', sub: u.id, clientId: a.id, clientName: a.name, aud: tl.resource, scope: [tl.scope], act: { sub: a.id }, sid: c.sid, trace: c.span(), jti: c.jti() }));
    c.push(policyDecision({ id: c.id('pol'), at: c.at(41_050), sub: u.id, actor: a.id, action: tl.name, resource: tl.resource, scopes: [tl.scope], result: 'PERMIT', policy: 'purchase-limits', rule: 'within-limit', trace: c.span() }));
    c.push(gatewayLog({ id: c.id('gw'), at: c.at(41_120), phase: 'decision', tool: tl.name, decision: 'allow', reason: 'policy permit', rule: 'default-allow-after-permit', agentId: a.id, onBehalfOf: u.id, scopes: [tl.scope], trace: c.span(), latencyMs: 9 }));
    const focus = c.push(gatewayLog({ id: c.id('gw'), at: c.at(41_420), phase: 'upstream', tool: tl.name, agentId: a.id, onBehalfOf: u.id, scopes: [tl.scope], status: 201, trace: c.span(), latencyMs: 280 }));
    return { events: c.events, traceId: c.trace.traceId, focus };
  },

  'denied-scope'(rng, start, { users, agents, apps, tools }) {
    const c = ctx(rng, start); const u = users.bao; const a = agents.researcher; const tl = tools.purchase;
    signinAndIssue(c, u, apps.shop, ['openid', tools.lookup.scope], 'https://gateway.example');
    c.push(tokenEvent({ id: c.id('tok'), at: c.at(40_000), kind: 'token.exchanged', sub: u.id, clientId: a.id, clientName: a.name, aud: tl.resource, scope: [tools.lookup.scope], act: { sub: a.id }, sid: c.sid, trace: c.span(), jti: c.jti() }));
    c.push(policyDecision({ id: c.id('pol'), at: c.at(41_040), sub: u.id, actor: a.id, action: tl.name, resource: tl.resource, scopes: [tools.lookup.scope], result: 'DENY', policy: 'purchase-limits', rule: 'scope-required', trace: c.span() }));
    const focus = c.push(gatewayLog({ id: c.id('gw'), at: c.at(41_100), phase: 'decision', tool: tl.name, decision: 'deny', reason: `token lacks scope ${tl.scope}`, rule: 'enforce-policy-deny', agentId: a.id, onBehalfOf: u.id, scopes: [tools.lookup.scope], trace: c.span(), latencyMs: 6 }));
    return { events: c.events, traceId: c.trace.traceId, focus };
  },

  'paused-approved'(rng, start, { users, agents, apps, tools }) {
    const c = ctx(rng, start); const u = users.carla; const a = agents.purchasing; const tl = tools.purchase; const ap = users.dmitri;
    signinAndIssue(c, u, apps.shop, ['openid', tl.scope], 'https://gateway.example');
    c.push(tokenEvent({ id: c.id('tok'), at: c.at(40_000), kind: 'token.exchanged', sub: u.id, clientId: a.id, clientName: a.name, aud: tl.resource, scope: [tl.scope], act: { sub: a.id }, sid: c.sid, trace: c.span(), jti: c.jti() }));
    c.push(policyDecision({ id: c.id('pol'), at: c.at(41_040), sub: u.id, actor: a.id, action: tl.name, resource: tl.resource, scopes: [tl.scope], result: 'PERMIT_WITH_OBLIGATION', policy: 'purchase-limits', rule: 'over-soft-limit', obligations: ['human-approval'], trace: c.span() }));
    const focus = c.push(gatewayLog({ id: c.id('gw'), at: c.at(41_100), phase: 'decision', tool: tl.name, decision: 'pause', reason: 'human approval required by policy', rule: 'obligation-human-approval', agentId: a.id, onBehalfOf: u.id, scopes: [tl.scope], trace: c.span(), latencyMs: 8 }));
    c.push(hitlEvent({ id: c.id('apr'), at: c.at(41_300), state: 'requested', agent: a.id, tool: tl.name, onBehalfOf: u.id, trace: c.span(), sid: c.sid }));
    c.push(hitlEvent({ id: c.id('apr'), at: c.at(88_000), state: 'approved', agent: a.id, tool: tl.name, onBehalfOf: u.id, approver: ap, comment: 'matches the quote', trace: c.span(), sid: c.sid }));
    c.push(gatewayLog({ id: c.id('gw'), at: c.at(88_200), phase: 'decision', tool: tl.name, decision: 'allow', reason: 'approval-approved', rule: 'resume-after-approval', agentId: a.id, onBehalfOf: u.id, scopes: [tl.scope], trace: c.span(), latencyMs: 4 }));
    c.push(gatewayLog({ id: c.id('gw'), at: c.at(88_500), phase: 'upstream', tool: tl.name, agentId: a.id, onBehalfOf: u.id, scopes: [tl.scope], status: 201, trace: c.span(), latencyMs: 300 }));
    return { events: c.events, traceId: c.trace.traceId, focus };
  },

  'killed-mid-run'(rng, start, { users, agents, apps, tools }) {
    const c = ctx(rng, start); const u = users.alice; const a = agents.purchasing; const tl = tools.purchase; const op = users.olga;
    signinAndIssue(c, u, apps.shop, ['openid', tl.scope], 'https://gateway.example');
    c.push(tokenEvent({ id: c.id('tok'), at: c.at(40_000), kind: 'token.exchanged', sub: u.id, clientId: a.id, clientName: a.name, aud: tl.resource, scope: [tl.scope], act: { sub: a.id }, sid: c.sid, trace: c.span(), jti: c.jti() }));
    c.push(policyDecision({ id: c.id('pol'), at: c.at(41_050), sub: u.id, actor: a.id, action: tl.name, resource: tl.resource, scopes: [tl.scope], result: 'PERMIT', policy: 'purchase-limits', rule: 'within-limit', trace: c.span() }));
    c.push(gatewayLog({ id: c.id('gw'), at: c.at(41_120), phase: 'decision', tool: tl.name, decision: 'allow', reason: 'policy permit', rule: 'default-allow-after-permit', agentId: a.id, onBehalfOf: u.id, scopes: [tl.scope], trace: c.span(), latencyMs: 9 }));
    c.push(gatewayLog({ id: c.id('gw'), at: c.at(41_420), phase: 'upstream', tool: tl.name, agentId: a.id, onBehalfOf: u.id, scopes: [tl.scope], status: 201, trace: c.span(), latencyMs: 280 }));
    c.push(killEvent({ id: c.id('kill'), at: c.at(70_000), agentId: a.id, operator: op, reason: 'runaway spend suspected', sid: c.sid }));
    const focus = c.push(gatewayLog({ id: c.id('gw'), at: c.at(71_000), phase: 'decision', tool: tl.name, decision: 'deny', reason: 'agent-killed', rule: 'kill-switch', agentId: a.id, onBehalfOf: u.id, scopes: [tl.scope], trace: c.span(), latencyMs: 2 }));
    return { events: c.events, traceId: c.trace.traceId, focus };
  },

  'orphaned-event'(rng, start, { users, agents, apps, tools }) {
    const c = ctx(rng, start); const a = agents.buildbot; const tl = tools.deploy;
    // No traceparent, no session id, no subject. The reason text carries a zero-width space on purpose.
    const focus = c.push(gatewayLog({ id: c.id('gw'), at: c.at(0), phase: 'decision', tool: tl.name, decision: 'allow', reason: `retry${ZWSP} from build-bot`, rule: 'service-account-allow', agentId: a.id, scopes: [tl.scope], latencyMs: 5, route: '/mcp/ci' }));
    return { events: c.events, traceId: null, focus };
  },

  'two-hop-delegation'(rng, start, { users, agents, apps, tools }) {
    const c = ctx(rng, start); const u = users.alice; const o = agents.orchestrator; const b = agents.booking; const tl = tools.book;
    signinAndIssue(c, u, apps.travel, ['openid', 'travel:book'], 'https://gateway.example');
    c.push(tokenEvent({ id: c.id('tok'), at: c.at(40_000), kind: 'token.exchanged', sub: u.id, clientId: o.id, clientName: o.name, aud: 'https://orchestrator.example', scope: [tl.scope], act: { sub: o.id }, sid: c.sid, trace: c.span(), jti: c.jti() }));
    c.push(tokenEvent({ id: c.id('tok'), at: c.at(42_000), kind: 'token.exchanged', sub: u.id, clientId: b.id, clientName: b.name, aud: tl.resource, scope: [tl.scope], act: { sub: b.id, act: { sub: o.id } }, sid: c.sid, trace: c.span(), jti: c.jti() }));
    c.push(policyDecision({ id: c.id('pol'), at: c.at(43_050), sub: u.id, actor: b.id, action: tl.name, resource: tl.resource, scopes: [tl.scope], result: 'PERMIT', policy: 'travel-rules', rule: 'delegation-depth-2-allowed', trace: c.span() }));
    c.push(gatewayLog({ id: c.id('gw'), at: c.at(43_120), phase: 'decision', tool: tl.name, decision: 'allow', reason: 'policy permit', rule: 'default-allow-after-permit', agentId: b.id, onBehalfOf: u.id, scopes: [tl.scope], trace: c.span(), latencyMs: 11, route: '/mcp/travel' }));
    const focus = c.push(gatewayLog({ id: c.id('gw'), at: c.at(43_500), phase: 'upstream', tool: tl.name, agentId: b.id, onBehalfOf: u.id, scopes: [tl.scope], status: 201, trace: c.span(), latencyMs: 350, route: '/mcp/travel' }));
    return { events: c.events, traceId: c.trace.traceId, focus };
  },
};

export const SCENARIOS = [
  { id: 'normal-purchase', title: 'Normal purchase through an agent', story: '{{users.alice.name}} asks {{agents.purchasing.name}} to place an order. The agent holds a delegated token, policy permits it, the gateway allows {{tools.purchase.name}}, and the tool server answers 201.', lesson: 'One complete chain: human, sign-in, token exchange, policy, gateway, tool.' },
  { id: 'denied-scope', title: 'Denied: the call exceeds the agent\'s scope', story: '{{users.bao.name}} lets {{agents.researcher.name}} read the catalog. The agent then tries {{tools.purchase.name}}, which needs {{tools.purchase.scope}}. Policy denies and the gateway blocks it; the tool is never reached.', lesson: 'A denied call is a complete, correct record. A missing tool result after a deny is not a gap.' },
  { id: 'paused-approved', title: 'Paused for a human, then approved', story: '{{agents.purchasing.name}} asks to place a large order for {{users.carla.name}}. Policy attaches a human-approval obligation, the gateway pauses, {{users.dmitri.name}} approves, and the call resumes.', lesson: 'Two people appear: the user the agent acts for and the approver. The sentence names both.' },
  { id: 'killed-mid-run', title: 'Agent killed mid-run', story: '{{agents.purchasing.name}} is running for {{users.alice.name}}. {{users.olga.name}} fires the kill switch. The kill event carries the run (session) but no trace id; the next call is denied.', lesson: 'Control-plane events join a trace only by session and time window, and the timeline labels that link as inferred.' },
  { id: 'orphaned-event', title: 'Orphaned event: no correlation id', story: '{{agents.buildbot.name}} calls {{tools.deploy.name}} and the gateway allows it, but the log has no traceparent, no session and no human. The text in the reason field hides a zero-width character.', lesson: 'Without a correlation id the event cannot be tied to a human or a transaction. It is shown as orphaned, not guessed at.' },
  { id: 'two-hop-delegation', title: 'Two-hop delegation chain', story: '{{users.alice.name}} asks {{agents.orchestrator.name}}, which hands the booking to {{agents.booking.name}}. The second exchange carries a nested act claim, so the chain reads human, orchestrator, sub-agent.', lesson: 'The nested act claim is the delegation chain. Two exchanges must be on record; a missing one shows as a gap.' },
];

export const getScenario = (id) => SCENARIOS.find((s) => s.id === id) ?? null;
export const describeScenario = (s, cast = CAST) => ({ id: s.id, title: s.title, story: resolveTokens(s.story, cast), lesson: s.lesson });

// Build and ingest one scenario instance; returns the identifiers a caller needs to query it.
export function runScenario(store, id, { rng, start, cast = CAST }) {
  const s = getScenario(id);
  if (!s) throw Object.assign(new Error('no such scenario'), { code: 'no_scenario' });
  const built = BUILDERS[id](rng, start, cast);
  const stored = built.events.map((e) => store.ingest(e.source, e.raw));
  const focusIndex = built.events.indexOf(built.focus);
  return { scenario: id, traceId: built.traceId, focusEventId: stored[focusIndex].id, eventIds: stored.map((e) => e.id) };
}

// Background events: sign-ins and token issues over the past days, plus a few BEYOND the 7-day retention window,
// which sit in the store but are invisible to the audit tools (that is the retention lesson).
export function seedBackground(store, { rng, now, cast = CAST }) {
  const { users, apps } = cast;
  const day = 86_400_000;
  const plan = [
    [-12, users.bao], [-10, users.carla], [-9, users.alice], // beyond retention
    [-6, users.bao], [-5, users.carla], [-4, users.dmitri], [-3, users.alice], [-2, users.olga], [-1, users.bao],
  ];
  const out = [];
  for (const [d, user] of plan) {
    const t = new Date(now.getTime() + d * day + rng.int(0, 3_600_000));
    const sid = `sid-${rng.hex(12)}`;
    out.push(ing(store, idpSignin({ id: `act-${rng.hex(10)}`, at: t, user, client: apps.shop, sid })));
    out.push(ing(store, tokenEvent({ id: `tok-${rng.hex(10)}`, at: new Date(t.getTime() + 15_000), kind: 'token.issued', sub: user.id, clientId: apps.shop.id, clientName: apps.shop.name, aud: 'https://gateway.example', scope: ['openid'], sid, jti: rng.hex(16) })));
  }
  return out;
}

const SEED_ORDER = ['normal-purchase', 'denied-scope', 'paused-approved', 'killed-mid-run', 'orphaned-event', 'two-hop-delegation'];
export function seedAll(store, { rng, now, cast = CAST }) {
  seedBackground(store, { rng, now, cast });
  const runs = [];
  SEED_ORDER.forEach((id, i) => {
    runs.push(runScenario(store, id, { rng, cast, start: new Date(now.getTime() - (SEED_ORDER.length - i + 1) * 10 * 60_000) }));
  });
  return runs;
}

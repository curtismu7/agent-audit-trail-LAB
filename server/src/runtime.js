// Runtime: the seeded store plus the tools and the join over it. In-memory only; Reset rebuilds everything.
import crypto from 'node:crypto';
import { DEFAULT_VERTICAL, PACKS, castFor } from './cast.js';
import { createJoin } from './join.js';
import { createRng } from './rng.js';
import { SCENARIOS, describeScenario, runScenario as run, seedAll } from './scenarios.js';
import { createStore } from './store.js';
import { createTools } from './tools.js';

export const DEFAULT_SEED = 20261021;

export const VERTICALS = Object.keys(PACKS);

export function createRuntime({ now = () => new Date(), seed = DEFAULT_SEED, vertical = DEFAULT_VERTICAL } = {}) {
  if (!castFor(vertical)) throw new Error(`unknown vertical pack: ${String(vertical).slice(0, 40)}`);
  const rt = { mode: 'mock', epoch: 0, seed, vertical };
  let rng;
  function build() {
    rng = createRng(seed);
    rt.store = createStore({ now, key: crypto.randomBytes(32) });
    rt.seeded = seedAll(rt.store, { rng, now: now(), cast: castFor(rt.vertical) });
    rt.tools = createTools(rt.store.view); // read-only view only
    rt.join = createJoin(rt.store.view);
    rt.epoch += 1;
  }
  build();
  rt.runScenario = (id) => run(rt.store, id, { rng, cast: castFor(rt.vertical), start: new Date(now().getTime() - 60_000) });
  rt.scenarios = () => SCENARIOS.map((s) => describeScenario(s, castFor(rt.vertical)));
  // Reset rebuilds the seeded store. An optional vertical pack switches the cast (people, agents, tools) at the same time.
  rt.reset = ({ vertical: next } = {}) => {
    if (next !== undefined && !castFor(next)) throw new Error('unknown vertical pack');
    const discarded = rt.store.chain.head;
    if (next !== undefined) rt.vertical = next;
    build();
    return { epoch: rt.epoch, vertical: rt.vertical, discardedHeadHash: discarded.hash, discardedLength: discarded.seq };
  };
  rt.close = async () => {};
  return rt;
}

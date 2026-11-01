# Agent Audit Trail LAB

Who did what through which agent? This lab shows how an organization answers that for AI agent activity: events from six systems land in one audit store, are queried through a small read-only MCP-style tool surface, and are joined by correlation ids into one timeline per action.

Tier: Demo
Repo: https://github.com/ping-sandbox/agent-audit-trail-LAB
Catalog: D17

Catalog D17 is the id this app carried in the standalone plan before it moved to a -LAB repo. It is carried over unchanged; whether it matches a real catalog row has not been checked, so treat it as a plan id.

## What is simulated

**Mock mode (the only mode, and the default).** Everything runs offline in one process. Events from six sources (identity provider, token service, gateway, policy engine, human approval, kill switch) are seeded and synthetic, every host is `.example`, every token shown is mock-issued and labelled so. They are normalized to one envelope, kept in an HMAC hash-chained store, queried through three read-only audit tools (REST and MCP JSON-RPC), and joined by correlation ids into a timeline with a plain-English sentence: the human, the agent acting for them (the delegation chain, from the `act` claim), the tool, the decision and the outcome. Gaps and orphans are made visible instead of papered over. The simulation banner on every tab says so.

**Live mode (not available).** There is no live audit source to connect to. The header **Live** button is there on every page, and it says so: pressing it shows why Live is not available and the page stays in mock mode. `AAT_LAB_MODE=live` in the settings file is refused at start with the same message.

> SIMULATION. Nothing here talks to a real identity or audit product. The original demo this teaches from read a PingOne audit activities API; the retention figure (about 7 days) and the field names it used were **as observed in a demo environment, UNVERIFIED against product documentation**. This app reproduces that behaviour so it can be taught, and makes no claim about real retention, field names or latency.

What it teaches:

1. The audit surface exposes exactly what is implemented: three read-only tools. There is no write tool to find (a test enumerates and probes).
2. A query past retention can come back **empty without an error**. The tool clamps the window and says "clamped to 7 days".
3. A timeline is only as good as its correlation ids. A trace id joins as fact; a session id joins as inference, labelled; no id means orphan.
4. A missing hop is a visible gap (no token exchange, no policy decision, a delegation chain longer than the exchanges on record).
5. The sentence is built only from fields in the events; with a human missing it says so rather than inventing one.
6. A hash chain makes edits, deletions, insertions and reordering detectable; truncating the tail needs an external head checkpoint.

## Run from a clone

Prerequisites: Node 26 or newer. Docker only if you use the Docker form. Mock mode works with no setup at all: no tenant, no credentials, no settings file.

```
git clone https://github.com/ping-sandbox/agent-audit-trail-LAB.git
cd agent-audit-trail-LAB
npm ci
npm run build
npm start
```

Open http://127.0.0.1:6600/ (the server serves the built UI itself, with a same-origin-only content security policy).

## Settings file

All standalone apps read one settings file, `~/Development/.env`, which must be mode 600. `STANDALONE_ENV` overrides its path. This app needs none of it. It parses the file (`util.parseEnv`) and takes exactly one optional key; no other key from the file ever enters the server's environment, and there is no per-app `.env` file:

- `AAT_LAB_MODE` (optional): `mock` (the default and the only mode that works). `live` is refused with an honest message. A bare `MODE` in the shared file is ignored, because it may belong to another app.

The shared file holds no `PORT`: the app keeps its port default in code. Admin credentials never belong in that file, and this app uses none. The doctor reports whether the file exists and its mode, and never prints a value.

## Ports, and what to do if the port is taken

```
Ports: agent-audit-trail-LAB listens on 6600 (set with AUDIT_TRAIL_PORT, default 6600).
Port range for this app: 6600-6649.

If the port is taken:
1. Find what is using it:
   lsof -iTCP:6600 -sTCP:LISTEN -n -P
2. If it is an old copy of this app, stop that process: kill <PID>.
3. If it is something else, stop it, or start this app on another port:
   AUDIT_TRAIL_PORT=<other port> npm start
4. Do not use 8080, 5173, 3000, 4000, 4400, 4510, 4600-4601, 18080, 19080 or 19090.
```

Other variables: `VITE_PORT` (Vite dev server, default 6610, `npm run dev --workspace web`), `HOST_PORT` (Docker host port, default 6600), `E2E_PORT` (the browser check, default: the first free port in 6620-6629), `AUDIT_TRAIL_BIND` (the container sets it to `0.0.0.0`; leave it unset on the host). Keep all of them inside 6600-6649. Ports 6601-6609 are reserved and unused, and 6630-6649 belong to the tests.

## Mock and live modes

The header has a **Mock / Live** toggle on every page, and the banner and the `mode: mock` chip show the mode. Mock is seeded, in-process data: scenarios append fresh synthetic events, the tamper demo works on a copy, Reset rebuilds the store. Live is refused as described above: nothing changes when you press it except the message.

## Health, doctor and reset

```
npm run doctor   # Node 26, bind, mode, shared settings file, diagram data, port range, deterministic seed, three read-only tools, netguard self-test, port free
npm run reset    # rebuilds the seeded store and hash chain of a running server
```

`GET /api/health` returns `demo-health/1`. `npm run reset` (optionally `AUDIT_TRAIL_WORKSPACE=<id>` and `--vertical=banking`) and `POST /api/reset` reset the server state. The header **Reset** button does the same and also puts the diagram boxes back where they started (box positions live in the page). The workspace id comes in `X-Workspace-Id` (1-32 characters of a-z, 0-9, hyphen; default `default`); each browser tab sends its own, at most 50 workspaces are held in memory, least recently used dropped. Presenter mode: press `P` (Escape leaves; a chord with Ctrl, Meta or Alt, a held key, and typing into a field are ignored) or use the header button; it enlarges text and hides secondary detail, and the simulation banner stays. The talk track is generated from data (`npm run talk-track` writes `docs/talk-track.md` from `content/talk-track.json`; a test fails if they drift).

## Docker (optional)

```
HOST_PORT=6600 docker compose up --build -d
```

The container publishes to 127.0.0.1 only (a test pins it), runs as a non-root user with a read-only file system and no capabilities, and has a health check on `/api/health`. Use OrbStack, not Docker Desktop.

## Tests

```
npm test    # server (node --test test/*.test.js), web (vitest), scripts
```

The shared checks are run by hand, because the scripts are not shipped into this repo's CI: `bash <AI-DEMO-Standalone>/scripts/check-drift.sh .`, `bash <AI-DEMO-Standalone>/scripts/check-css.sh .` and `node <demo-kit-base>/scripts/conformance.mjs . --new` (it reports two advisory rule 18 warnings on purpose: the SE k8s build is deferred). `npm run e2e` drives the built UI in a real browser (Playwright, Chromium; it is also a CI job, and it needs nothing outside this repo); `npm run mutation-check` breaks key behaviours on a temporary copy and expects the tests to fail (slow, not part of `npm test`).

On Node 26: 234 tests pass (157 server, 35 web, 42 scripts).

## Troubleshooting

- **The page says "Cannot reach the API".** The server is not running, or it is on another port. Start it (`npm start`) and check `AUDIT_TRAIL_PORT`.
- **Port is taken.** See "Ports, and what to do if the port is taken" above.
- **`npm start` refuses to start.** Run `npm run doctor`; the first failing line says why (Node older than 26, a port outside 6600-6649, `AAT_LAB_MODE=live`).
- **The server answers 421.** The Host header must be `localhost`, `127.x.x.x` or `[::1]`; anything else is refused on purpose.
- **The browser shows a few red lines in the console after a tamper or bad search.** Those are deliberate 4xx answers from refusals, not failures.

## Ownership

- Owner: the Ping demo family owner (Demo tier).
- License: MIT (see `LICENSE`).
- Found a problem? Open an issue on the repo.

## Reference

### The UI

Six tabs, a simulation banner and a `mode: mock` header on every one, a DEMO badge, dark and light themes (no purple), usable at 375px:

- **Story**: scenario picker and Run. Shows the plain-English "who did what through which agent" sentence, the delegation chain drawn as human -> agent hop(s) -> tool, the facts with the event ids they came from, the hops present or missing, and the per-action timeline with ORPHAN and gap markers and a `session-inferred` label on links that are inference, not proof.
- **Events**: search (source, type, agent, human, tool, decision, trace, session, orphaned, days, page size) with cursor pagination, the summary counts, and a raw event viewer: the normalized envelope next to the source's own record. Hidden characters show as `[U+XXXX]`; token events carry a MOCK-ISSUED badge.
- **Retention**: a slider asks for 1-60 days. A naive upstream silently returns 0 events past the edge; the audit tool clamps and says "clamped to 7 days". The 7-day figure carries an UNVERIFIED badge.
- **Tools**: `tools/list` and `tools/call` against `POST /mcp`, request and response JSON shown as sent. Exactly three read-only tools.
- **Integrity**: verify the hash chain; tamper demo (on a copy) for seven kinds of tampering (edit, edit-timestamp, edit-and-rehash, delete, insert, reorder, truncate).
- **Diagram**: event sources -> normalizer -> store -> audit tools -> join. The diagram is diagram-studio/1 data loaded by name (`server/diagrams/audit-flow.json`). Boxes are draggable (arrow keys too). **Simulate** runs the selected scenario for real, queries the audit tool for it, joins it, and walks five steps quoting the real numbers; speed control; **Reset diagram** and the header **Reset** both restore the box positions.

### Rulebook map (tier Demo)

| Rule | Where |
|---|---|
| 1 Mock mode, Mock / Live toggle | the header toggle on every page; Live is refused with a message (`server/src/config.js`, `AAT_LAB_MODE`) |
| 3 doctor, Reset, presenter mode, talk track | `npm run doctor`, `npm run reset` and `POST /api/reset`, the `P` key, `content/talk-track.json` -> `docs/talk-track.md` |
| 6 Learning Hub pack | `content-pack.json` (`npm run content-pack` regenerates and validates it against `docs/content-pack.schema.json`, a copy of the Learning Hub's schema, kept in step by hand) |
| 9 shelf entry | `docs/shelf-entry.json` (portable `composeFile`, catalog id `D17`) |
| 10 stories as data, 3 vertical packs | `server/src/scenarios.js` stories with `{{cast}}` tokens; `server/src/cast.js` packs `retail`, `banking`, `healthcare`; a test fails on an undefined token in any pack. Switch with the Cast select or `POST /api/reset {"vertical":"banking"}` |
| 12 `customer.config` | `customer.config.example.json` (copy to the git-ignored `customer.config.json`): brand title and tagline, vocabulary, default vertical; bounded plain labels only, bad values fall back |
| 13 workspace id | `X-Workspace-Id` header, see above |
| 15 health | `GET /api/health` |
| 17 diagrams | `server/diagrams/audit-flow.json`, served by `GET /api/diagram` |

Not done: rule 18's SE k8s build is deferred by the owner (2026-10-31), so there are no k8s manifests and no hosted variant. Rule 16 (pi.flow login) does not apply: the app has no sign-in.

### Try it

```
curl -s localhost:6600/api/health
curl -s localhost:6600/api/scenarios                      # six scenarios, stories, and the ids they produced
curl -s 'localhost:6600/api/events?limit=5'               # the search tool
curl -s 'localhost:6600/api/events?days=30&limit=1'       # note the "clamped to 7 days" note
curl -s localhost:6600/api/retention-demo                 # the silent-empty trap next to the clamp
curl -s 'localhost:6600/api/join?traceId=<a traceId from /api/scenarios>'
curl -s localhost:6600/api/chain/verify
curl -s -X POST -H 'content-type: application/json' -d '{"kind":"edit"}' localhost:6600/api/chain/tamper-demo
curl -s -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' localhost:6600/mcp
```

### API

Audit tools (read-only; the same three tools over REST and over MCP):

- `GET /api/events` search with `days`, `limit`, `cursor`, `eventType`, `source`, `traceId`, `sessionId`, `actor`, `subject`, `tool`, `decision`, `orphaned`
- `GET /api/events/:id` one event with its inert raw record
- `GET /api/events/summary` counts by type, source, actor, decision; traces; orphans
- `POST /mcp` JSON-RPC 2.0: `initialize`, `ping`, `tools/list`, `tools/call` (`search_audit_activities`, `get_audit_activity`, `audit_summary`)
- `GET /api/tools` the tool list and the lesson

Analysis and teaching:

- `GET /api/join?traceId=...` or `GET /api/join?eventId=...` the timeline, hops, gaps, delegation chain and sentence
- `GET /api/retention-demo?days=30` the raw upstream (silently empty) beside the audit tool (clamped and said)
- `GET /api/chain/verify` and `GET /api/chain` the hash chain
- `POST /api/chain/tamper-demo` tamper with a **copy** (`edit`, `edit-timestamp`, `edit-and-rehash`, `delete`, `insert`, `reorder`, `truncate`) and see verify fail

Demo controls (not audit tools):

- `GET /api/health` (`demo-health/1`), `GET /api/info`, `GET /api/scenarios`, `GET /api/diagram`
- `POST /api/scenarios/:id/run` append a fresh instance of a scenario, `POST /api/reset` rebuild the seeded store

### Scenarios

| id | what it teaches |
|---|---|
| `normal-purchase` | one complete chain: human, sign-in, token exchange, policy, gateway, tool |
| `denied-scope` | a scope-exceeding call is denied; no tool result after a deny is not a gap |
| `paused-approved` | the gateway pauses, a second human approves, the call resumes |
| `killed-mid-run` | the kill switch has no trace id; it joins by session and time window and is labelled inferred |
| `orphaned-event` | no traceparent, no session, no human: shown as orphaned, nothing guessed; a hidden character is revealed |
| `two-hop-delegation` | a nested `act` claim gives the chain human, orchestrator, sub-agent |

Other docs: [architecture](docs/architecture.md), [safety and provenance](docs/safety.md), [talk track](docs/talk-track.md), shelf entry `docs/shelf-entry.json`.

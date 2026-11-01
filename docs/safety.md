# Safety and provenance

## What this app is not

It is a simulation. There is no tenant, no network call, no credential and no real audit product. All events come from a seeded generator
(`server/src/scenarios.js`, `server/src/sources.js`) using a fictional cast (`server/src/cast.js`) and `.example` hosts. Tokens shown in
events are claim sets labelled `MOCK-ISSUED claims, not a real credential`; no real secret exists in this app. Raw values are visible on
purpose (this is education).

## Provenance and the UNVERIFIED label

The original demo (a three-tool audit server in a larger project) read a PingOne audit activities API. Facts taken from its comments:

- retention of roughly 7 days: a 30-day window returned zero events while a 7-day window returned hundreds;
- asking past retention is not an error, it silently comes back empty;
- the identity-provider event field names (`id`, `recordedAt`, `action.type`, `actors.user`, `actors.client`, `resources`).

All of that was **as observed in the demo environment, UNVERIFIED against product documentation**.
This app makes no claim about real retention, field names or latency. The other five event shapes (token service, gateway, policy engine, human approval, kill switch) are
invented for teaching and match no product. The 7-day figure is a constant in `server/src/store.js` (`RETENTION_DAYS`) and every place that
states it carries the UNVERIFIED note (tool descriptions, clamp notes, `/api/info`, doctor, README).

## Network and process

- Binds `127.0.0.1` only. The container binds `0.0.0.0` inside, via `AUDIT_TRAIL_BIND`, and Docker publishes `127.0.0.1` only (`scripts/compose.test.mjs` pins it).
- Only ports 6600-6649 are used. `GET /api/health` is the only thing a shelf needs.
- No outbound connection exists. The server installs a runtime netguard before anything else (`server/src/netguard.js`): every non-loopback fetch, TCP connect, DNS lookup and resolve, UDP send and UDP connect is refused and recorded. It has a self-test (run by `npm run doctor`) and a test that a whole run of the app makes zero attempts.
- Settings come only from the one shared file (`~/Development/.env`, or `STANDALONE_ENV`), read with `util.parseEnv`; the app takes one optional key, `AAT_LAB_MODE`, and no other key from the file ever enters the environment. There is no per-app `.env` loader. `AAT_LAB_MODE=live` is refused at start with an honest message: this app has no live audit source.
- Strict Host check (421 for anything not loopback), Origin and Sec-Fetch-Site guard on every non-read route, JSON-only bodies (415 otherwise), small body limits (2 kB REST, 8 kB MCP).
- No credential header is accepted (Authorization, Proxy-Authorization, X-Api-Key): the request is refused with 400, not ignored. Cookie headers are not checked and never read.
- 500s return `{"error":"server_error"}` and nothing else; details go to the server log only.
- State is in memory. Capped at 2000 events; a scenario run at the cap answers 409, nothing is dropped. `POST /api/reset` rebuilds.

## Read-only audit surface

Three tools exist: `search_audit_activities`, `get_audit_activity`, `audit_summary`. They receive a frozen read-only view of the store
(`search`, `get`, `summary`, `windowEvents`), not the store, so they cannot append, reset or reach the hash chain. Tests enumerate write-shaped
tool names and probe them, check REST routes answer 405 to every write verb, and check the chain head and size do not move across tool calls.
The demo controls (`POST /api/scenarios/:id/run`, `/api/reset`, `/api/chain/tamper-demo`) are separate, are not tools, and the tamper demo only
ever touches a copy.

## Retention and limits

A search or summary window longer than retention is **clamped** and the result carries `clamped: true`, `requestedDays` and a note
("clamped to 7 days ..."). A `limit` over 200 is clamped and noted. Cursors are keyset cursors this server issues (`c1.<ms>.<seq>`); anything
else is refused. An event outside the window is also "not found" by id and absent from joins, matching what the upstream could see.

## Inert text

Every string from an event source is bounded and has hidden characters (zero-width, bidi controls, tag characters, lone surrogates, control
characters) replaced by `[U+XXXX]` before it is stored. The event is flagged `hidden-characters`. The raw record is made inert too (depth,
array and key counts capped), keys included. The `orphaned-event` scenario carries a zero-width space on purpose.

## The join is not allowed to invent

The sentence and every clause come from fields of events in the timeline. Each clause lists the event ids it rests on. If there is no human in
the events the sentence says "no human subject is recorded". A session-id link is shown as `session-inferred` with a note that it is an
inference. Events with no correlation id are shown orphaned; events from the same agent nearby are listed as "possibly related, not joined".

## Hash chain

Each entry's hash is HMAC-SHA256 over `{seq, at, event, prevHash}` with a random per-process key. Editing an entry is caught at that entry;
re-hashing with plain SHA-256 still fails; delete, insert and reorder break the sequence; truncating the tail is caught only by comparing with a
head checkpoint kept outside the entry list (in production it would live in a system the writer cannot rewrite). The key lives in memory and
there is no asymmetric key generation anywhere (it aborted on Node 20, and the rule stays on every Node version). Because the key is per process, a verify only means something within the
process that wrote the chain: a deliberate simplification.

## Approver and operator

There is no login. The approver and the operator in the scenarios are fictional events, not an access control feature of this app.

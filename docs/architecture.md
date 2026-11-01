# Architecture

```
 idp   token   gateway   policy   hitl   killswitch      six sources, six raw shapes (sources.js)
   \     \       |        /       /       /
              normalizer (normalize.js)                  one envelope, traceparent / correlation ids, inert text
                    |
        hash-chained store (chain.js, store.js)          append-only, HMAC chain, retention window
                    |
        read-only view  { search, get, summary, windowEvents }
           |                                   |
   three audit tools (tools.js)         correlation join (join.js)
   REST /api/events*  MCP /mcp          /api/join  -> timeline, hops, gaps, delegation, sentence
```

The web UI (`web/`, React + Vite, built to `web/dist` and served by the same Express app with a same-origin CSP) draws its diagram from
diagram-studio/1 data (`server/diagrams/audit-flow.json`, served by `GET /api/diagram?name=audit-flow`; no nodes or edges are built by hand):
event sources, normalizer, store, audit tools, join/timeline. Simulate is one real pass: run the scenario
(`POST /api/scenarios/:id/run`), query the audit tool for it (`search_audit_activities` by trace id, or `get_audit_activity` for an orphan),
join it, verify the chain; the five caption steps quote those results. The UI only reads what the API returns: names in the delegation
chain come from event fields in the join response, and an id no event names is shown as the id. Every event string is rendered as React
text, with hidden characters shown as `[U+XXXX]` a second time on the client.

## Files

- `server/src/cast.js` fictional people, agents, tools, `.example` hosts, and `{{token}}` resolution (an undefined token throws).
- `server/src/sources.js` the six raw event makers. `server/src/normalize.js` the envelope. `server/src/trace.js` strict W3C `traceparent`.
- `server/src/chain.js` the hash chain and tamper demo. `server/src/store.js` retention, search, get, summary, the mock "upstream" trap.
- `server/src/tools.js` the three tool definitions and strict argument validation. `server/src/mcp.js` the JSON-RPC endpoint.
- `server/src/join.js` the correlation join. `server/src/scenarios.js` stories and builders. `server/src/runtime.js` wiring and Reset.
- `server/src/app.js` routes and guards, `server/src/safety.js` Host / Origin / credential guards, `server/src/doctor.js` and `health.js`.
- `server/src/netguard.js` the runtime netguard (fetch, TCP, DNS, UDP send and UDP connect refused, with a self-test). `server/src/settings.js` the shared settings file reader. `server/src/config.js` the mode setting and `customer.config.json`. `server/src/diagramData.js` and `diagramStudioValidate.js` the diagram loader and its validator copy. `server/src/talkTrack.js` renders `docs/talk-track.md` from `content/talk-track.json`.

## Envelope

`id, source, sourceId, type, sourceType, recordedAt, traceId, spanId, traceparent, sessionId, subject, subjectName, actor, actorName,
delegation[], tool, resource, scopes[], decision{result,rule,reason}, outcome, flags[], raw` plus client, approver and operator ids and names
where a source has them. Absent facts are `null`. Flags: `hidden-characters`, `invalid-traceparent`, `invalid-trace-id`, `no-correlation-id`.

## Correlation rules

1. `traceId` equal: same transaction (`link: trace`).
2. No trace id but the same `sessionId`, inside [first event minus 1 hour, last event plus 10 minutes]: attached as `session-inferred`. A session holds many traces, so a session id never pulls in events that have their own trace id.
3. Starting from an event with no trace id: one matching trace in its session joins it; more than one is `ambiguous` and not joined; none is `orphan`.
4. Agent and tool ids never join anything. For an orphan they only produce a "possibly related, not joined" list.

## Hops and gaps

Hops: identity, token, gateway, policy, approval, tool, killswitch. Gap rules (fields only): a human subject with no sign-in; an acting agent with
no token exchange; a delegation chain longer than the exchanges on record; an allowed or paused call with no policy decision; a pause with no
approval; more allows than tool results. A deny with no tool result is not a gap.

## Scenarios

`normal-purchase`, `denied-scope`, `paused-approved`, `killed-mid-run`, `orphaned-event`, `two-hop-delegation`. The seed at boot (and after
Reset) holds background sign-ins over the last days, six events beyond the retention window, and one instance of each scenario. Each run
appends a fresh instance. Ports: 6600 server; 6601-6609 reserved for stubs (none used; CI's doctor uses 6609); 6610 vite dev; 6620-6629 e2e; 6630-6649 tests.

## Determinism and time

`rng.js` is a seeded generator; the same seed gives byte-identical events. Every clock is injected (`now`), so tests use a fixed `NOW` and
never sleep.

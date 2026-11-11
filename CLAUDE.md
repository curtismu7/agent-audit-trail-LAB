# agent-audit-trail-LAB (catalog D17, tier Demo)

Who did what through which agent. Seeded synthetic events from six sources -> normalizer -> hash-chained store -> three read-only audit tools (REST and MCP JSON-RPC) -> correlation join. Fully mock: the header has a Mock | Live toggle on every page, and Live is refused with an honest message (the app has no live audit source). Node 26 only.

## Run and test
- `npm ci`, `npm run build` (web), `npm test` (server `node --test test/*.test.js`, web vitest, `scripts/*.test.mjs`; always globs, never a directory), `npm run doctor`, `npm start` (http://127.0.0.1:6600).
- `npm run content-pack` and `npm run talk-track` regenerate `content-pack.json` and `docs/talk-track.md` (a test fails when either is stale). `npm run reset` resets a running server.
- By hand: `npm run e2e` (Playwright, real browser; also a CI job), `npm run mutation-check` (slow), `bash ~/Development/AI-DEMO-Standalone/scripts/check-drift.sh .` and `check-css.sh .`, `node ~/Development/demo-kit-base/scripts/conformance.mjs . --new` (two rule 18 warnings are expected: the SE k8s build is deferred).
- Docker (OrbStack, never Docker Desktop): `HOST_PORT=6600 docker compose up --build -d`, published on 127.0.0.1 only.

## Rules that bite
- Ports 6600-6649 only (server 6600, vite 6610, e2e 6620-6629, tests 6630-6649 via `server/test/helpers.js`, CI doctor 6609). Bind 127.0.0.1; Docker publishes loopback only.
- Settings come only from the one shared file `~/Development/.env` (or `STANDALONE_ENV`), through `util.parseEnv`, taking one key, `AAT_LAB_MODE`. No per-app `.env` loader, never a bare `MODE`, no `process.env.MODE`.
- No network, no credentials, no tenant. Hosts are `.example`. The netguard (`server/src/netguard.js`, incl. UDP send and connect) is installed first and has a self-test. Retention (~7 days) is UNVERIFIED, "as observed in the demo environment": say so wherever it is stated.
- The tool surface is exactly three read-only tools over a read-only store view. Never add a write tool. Demo controls (run, reset, tamper) are not tools.
- The join sentence is built only from event fields; every fact cites event ids. Every event string is inert (hidden characters shown as [U+XXXX]). Tests use injected clocks (`NOW` in helpers), no sleeps.
- The hash chain uses HMAC; no EC key generation (`generateKeyPair`), ever.
- The diagram is diagram-studio/1 data (`server/diagrams/audit-flow.json`) loaded by name; never hand-build nodes or edges. Reset restores box positions.
- UI: `web/src/styles/standalone-ui.css` is vendored byte-for-byte; app CSS uses tokens only (no colour literals, no `prefers-color-scheme`, no `!important`, breakpoints 600/900). Run buttons use `aria-disabled`, not `disabled`. Presenter mode: `P` toggles, Escape leaves, modifier chords ignored; the banner always stays.
- `X-Workspace-Id` selects an in-memory workspace. Delegation chains that cycle or exceed 8 hops are flagged and shown as a gap. A link made by session id alone is worded as an inference.
- No AI attribution anywhere (owner, 2026-11-07): no Co-Authored-By trailer and no "Generated with" line in commits, PR bodies or files; CI runs `scripts/check-no-ai-attribution.sh`. Never `--no-verify`. Never print the forbidden-strings list.

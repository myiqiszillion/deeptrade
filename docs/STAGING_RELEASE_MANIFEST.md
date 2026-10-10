# STAGING RELEASE MANIFEST

## RELEASE IDENTIFIER
- **Release Status:** CONDITIONAL RELEASE CANDIDATE (Docker Staging Verified, Process Teardowns Sealed)
- **Target Environment:** Docker Staging (Docker Desktop WSL2 / Linux containers, Caddy TLS/SPA, Node 24 Alpine)
- **Date:** 2026-10-11

## BASELINE CONDITIONS
This release incorporates the working tree source modifications verified through unit, integration, E2E, and Docker staging test suites.

### Key Architectural & Teardown Hardening
1. **Integration Test Suite Teardown (Task 1):**
   - Removed forced `process.exit(0)` from `server/test/integration/index.ts`.
   - Exported `closeServer()` in `server/src/index.ts` to deterministically terminate HTTP, WebSocket server, zombie connection timers, and market context subscriptions.
   - Unreferenced `heartbeatInterval` in `server/src/index.ts`.
   - Updated `server/test/integration/alertDelivery.test.ts` to cleanly invoke `closeServer()` and `marketDataStore.close()`.
   - Runner completes all 7 suites (Smoke, History, WS, AuthFlow, Behavioral, DepthRecovery, AlertDelivery) and exits with natural exit code 0.

2. **Deterministic Playwright E2E Runner (Task 2):**
   - Created `scripts/run_e2e.mjs` to govern web server lifecycle, port readiness polling, and process tree teardown (`taskkill /PID /T /F` on Windows) without leaving zombie processes.
   - Partitioned test runs by spec file to eliminate Chromium worker resource accumulation.
   - Verified 19/19 tests PASS with runner exit code 0 and ~4s teardown.

3. **Stripe Webhook Idempotency & Reliability (Task 5):**
   - Added `webhook_events` audit table to SQLite store.
   - Implemented event ID deduplication in `applyStripeEvent` (`hasWebhookEvent`, `recordWebhookEvent`).
   - Implemented stale out-of-order event rejection: prevents delayed update events from resurrecting cancelled subscriptions.
   - Verified via unit test suite (`server/test/unit/billing.test.ts`).

4. **Network Exposure Hardening (Task 6):**
   - Updated `docker-compose.yml` to bind proxy ports to `${PROXY_BIND_IP:-127.0.0.1}:80:80` and `443:443`, preventing unintentional LAN exposure.
   - Documented `PROXY_BIND_IP` in `.env.example`.
   - Verified backend port 8080 is internal only (`expose`), and sensitive files (`.env`, `*.sqlite`, `backups`) return 404 in Caddy.

5. **Docker Build Files:**
   - `.dockerignore`: Excluded database files (`data/`, `staging_data/`, `backups/`, `*.sqlite*`), build dist, test results, and scratch scripts.
   - `Dockerfile`: Added `client/package.json` for pnpm workspace resolution, added `COPY scripts scripts`, created `/app/backups` directory.
   - `deploy/Caddy.Dockerfile`: Added `server/package.json` for workspace resolution.
   - `deploy/Caddyfile`: Reverse proxy for WS/API, blocks sensitive paths, serves static SPA.

### Docker Image Fingerprints
- `deepchart-app:latest`: Built from Node 24 Alpine with multi-stage build.
- `deepchart-proxy:latest`: Built from Caddy 2 Alpine with pre-compiled Vite production frontend.

### Verification Evidence Summary
- `pnpm typecheck:all`: Exit code 0
- `pnpm test:unit`: Exit code 0
- `pnpm test:integration`: Exit code 0 (deterministic teardown, no forced exit)
- `pnpm verify:p0`: Exit code 0 (13/13 assertions)
- `pnpm test:e2e`: Exit code 0 (19/19 assertions, clean teardown)
- Staging Checks: 42/42 PASS

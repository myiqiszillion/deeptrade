# PRODUCTION READINESS

This document outlines the current state of DeepChart in preparation for Production Deployment.

## ARCHITECTURE & SOFTWARE STACK
- **Frontend:** React SPA built with Vite, served via Caddy 2.
- **Backend:** Node.js native HTTP Server + WebSockets running on Node 24 Alpine.
- **Reverse Proxy:** Caddy 2 with automated local/production TLS termination and isolated handle blocks.
- **Database:** SQLite in WAL mode with volume persistence (`/app/data`) and live `VACUUM INTO` backups (`/app/backups`).
- **Data Provider:** Databento (Fail-Closed when unconfigured or offline).

## CHECKLIST

### 1. Codebase Integrity
- [x] Static Analysis (TypeScript typecheck passed: `pnpm typecheck:all` exit code 0)
- [x] Unit Tests (100% passed: `pnpm test:unit` exit code 0)
- [x] Integration Tests (Passed: `pnpm test:integration` exit code 0)
- [x] E2E Tests (19/19 Playwright assertions passed with deterministic teardown, exit code 0 via `scripts/run_e2e.mjs`)
- [x] P0 Critical Safeguards Verified (13/13 passed: `pnpm verify:p0` exit code 0)
- [x] Production Build Verified (`pnpm build:all` exit code 0)

### 2. Operational Environment (Docker Staging Verified)
- [x] Docker Build Verified (`deepchart-app` and `deepchart-proxy` multi-stage builds succeed)
- [x] Docker Networking & Volume Mounts Verified (`deepchart_default` network, loopback proxy bind `127.0.0.1`, `app-data` persistent volume)
- [x] Caddy Configuration applied successfully (HTTPS, SPA fallback, WebSocket upgrade proxy, sensitive path block)
- [x] Container Health Checks Verified (`deepchart-app-1` reports healthy, Caddy healthy)
- [x] Resource Footprint Staging Baseline: ~25.0 MiB RSS for Node backend, ~17.5 MiB RSS for Caddy under idle/smoke load. *(Lưu ý: Không đánh đồng idle baseline với full sustained 24h stress profiling)*

### 3. Data Integrity & Persistence
- [x] SQLite WAL mode correctly configured (`PRAGMA journal_mode = wal`)
- [x] Application-level WAL-safe online backup functioning (`VACUUM INTO` via `scripts/backup_db.mjs`)
- [x] Container-level persistent storage verification (data and alert rules persist across container restart)
- [x] Backup integrity verified (`PRAGMA integrity_check` returns `ok` on snapshots)
- [x] Safe failure handling when data vendor stream terminates (Fail-Closed transparent state)
- [x] Memory lifecycle check: 100 mount/unmount canvas cycles verified (<25MB heap diff in Playwright memory spec; sustained multi-day production profiling to be monitored continuously)

### 4. Security & Compliance
- [x] Passwords hashed securely using `node:crypto` **scrypt** (constant-time verification).
- [x] JWT based authentication for API and WebSocket with strong staging secret injection.
- [x] Token revocation supported via JTI blocklist persisted in SQLite.
- [x] Stripe Webhook event-level idempotency: Dedicated `webhook_events` audit table, deduplication by `event.id`, rejection of out-of-order stale updates.
- [x] Brute force login prevention (LoginGuard with IP+username lockout).
- [x] Rate limiting on all API endpoints (Sliding Window).
- [x] Caddy CSP, CORS, and standard web security headers, plus explicit WebSocket Origin enforcement.
- [x] Loopback network binding (`PROXY_BIND_IP=127.0.0.1`) preventing unintended LAN exposure on staging host.
- [x] Sensitive paths protected (`.env`, `*.sqlite`, `/backups` return 404).

### 5. Third-Party Services & Vendor Data Verification
- [ ] Databento Live Credentials Active and Entitlements valid: **BLOCKED** (Pending Operator API Key)
- [ ] Vendor Data Verified: Market analytics algorithms (Footprint, Heatmap, CVD, GEX) fail-closed verified; live market vendor stream verification **PENDING LIVE FEED**.
- [ ] Stripe Production Webhooks validated against production secret: **PENDING PRODUCTION ONBOARDING**

## FINAL DECISION
DeepChart Docker Staging is **DOCKER STAGING VERIFIED**.
Production Readiness status: **CONDITIONAL RELEASE CANDIDATE**.
Production public deployment remains blocked solely pending Operator injection of valid vendor credentials (`DATABENTO_API_KEY` and production `STRIPE_*`).

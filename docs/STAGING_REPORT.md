# STAGING REPORT — FIRST REAL DOCKER STAGING BOOT

## 1. Executive Summary

- **Execution Date:** 2026-10-10
- **Environment:** Windows Host, Docker Desktop 4.94.0 (Engine 29.8.2, Compose v5.5.1, Linux/WSL2 Kernel 6.18.40.1, amd64)
- **Staging Classification:** **DOCKER STAGING VERIFIED**
- **Production Readiness Classification:** **CONDITIONAL RELEASE CANDIDATE** (Vendor Blocked solely on Databento API Key)

All 10 operational goals of the First Real Docker Staging Boot were executed and verified against real running containers:
1. Docker images built successfully (`deepchart-app:latest`, `deepchart-proxy:latest`).
2. Node.js backend running in container as non-root `node` user with healthcheck `Up (healthy)`.
3. React/Vite production frontend served via Caddy 2 with automatic TLS and SPA routing.
4. Caddy reverse proxies REST API (`/healthz`, `/api/v1/instruments`, `/metrics`).
5. Caddy reverse proxies WebSocket (`wss://localhost/`) with protocol switching, heartbeat, and subscription changes.
6. SQLite volume persistence operational in WAL mode on Docker named volume `app-data`.
7. Data (users, alert rules) retained 100% after container restart.
8. Safe online backup executed via `VACUUM INTO` and verified with `PRAGMA integrity_check` returning `ok`.
9. Graceful container shutdown verified (`SIGTERM` -> cleanup sockets -> close SQLite -> exit 0).
10. All Staging Acceptance Gates passed (42/42 automated staging checks, 13/13 P0 checks, 100% unit tests, 100% integration tests, 19/19 E2E Playwright assertions).

---

## 2. Docker Runtime & Stack Status

- **Docker Desktop Version:** 4.94.0 (241994)
- **Docker Engine Version:** 29.8.2 (API 1.56, Linux/amd64, containerd v2.3.6, runc 1.5.1)
- **Docker Compose Version:** v5.5.1
- **Host Architecture:** Windows 10/11 x86_64, WSL2 Linux backend, 12 CPUs, 15.5 GiB RAM allocated
- **Running Containers:**
  - `deepchart-app-1`: Up (healthy) on Docker internal network, port 8080 exposed.
  - `deepchart-proxy-1`: Up on host ports 80/443 (HTTP/3, HTTP/2, HTTP/1.1 enabled).
- **Resource Footprint:**
  - `deepchart-app-1`: ~25.0 MiB Memory RSS, < 0.05% idle CPU.
  - `deepchart-proxy-1`: ~17.5 MiB Memory RSS, 0.00% idle CPU.

---

## 3. Detailed Verification Results

### A. Frontend via Caddy
- **Homepage:** HTTP 200 OK via `https://localhost/`.
- **SPA Routing:** Direct access to `/chart/ES` rewrites to `/index.html` without 404.
- **Static Assets:** CSS (`index-zrNDSRtu.css`) and JS (`index-BC6X2-DB.js`, `react-vendor-DAtxSHgt.js`) load with HTTP 200 and gzip/zstd compression.
- **Port 80 Redirect:** HTTP `http://localhost/` returns HTTP 308 Permanent Redirect to `https://localhost/`.
- **Security Headers:** HSTS (`max-age=31536000; includeSubDomains`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Server` header stripped.
- **Sensitive Path Protection:** Requests to `/.env`, `/market_data.sqlite`, `/backups` return HTTP 404 Not Found.

### B. Backend REST API via Reverse Proxy
- **`/healthz`:** HTTP 200 OK returning `{"status":"ok","uptimeSec":...,"sessions":...,"feedStatus":"UNAVAILABLE"}`.
- **`/api/v1/instruments`:** HTTP 200 OK returning the full catalog of 67 CME instruments.
- **`/metrics` Authorization:** Unauthenticated request rejected with HTTP 401. Authenticated request with `METRICS_TOKEN` returns HTTP 200 and 36 lines of Prometheus metrics (`deepchart_store_rows`, etc.).
- **User Authentication:** 
  - Registration of `stg_user_a` and `stg_user_b` succeeded with HTTP 201 and issued valid signed JWT tokens.
  - Invalid password rejected with HTTP 401.
  - Valid password login returned HTTP 200 and renewed JWT token.
- **Alert Rules & User Isolation:**
  - User A created alert rule for `ES` (threshold 250) -> HTTP 201 Created.
  - User B queried rules -> HTTP 200 with 0 rules (User isolation verified).
  - User A queried rules -> HTTP 200 with 1 rule.

### C. WebSocket Reverse Proxy
- **Handshake & Upgrade:** `wss://localhost/` upgrades to 101 Switching Protocols.
- **Authentication Enforcement (`AUTH_REQUIRED=1`):**
  - Connection without token: Rejected with Close Code `1008` (Authentication required).
  - Connection with invalid token: Rejected with Close Code `1008` (Invalid authentication token).
  - Connection with valid JWT token: Upgrade succeeds.
- **Origin Protection:** Connection with unauthorized `Origin: https://malicious-attacker-domain.com` rejected with Close Code `1008` (Origin not allowed).
- **Protocol & Subscription:**
  - Default connection receives `INIT_STATE` for `ES`.
  - PING message receives immediate `PONG` response.
  - Client subscription change (`{"type":"SUBSCRIBE","symbol":"NQ"}`) receives updated `INIT_STATE` for `NQ`.
- **Concurrency & Disconnect:** Multiple authenticated clients (User A and User B) connected concurrently; graceful disconnect (`code: 1000`) cleanly processed by server.

### D. SQLite Persistence & Backup/Restore
- **Journal Mode:** Verified `PRAGMA journal_mode;` returns `wal`.
- **Container Restart Resilience:**
  - `docker compose restart app` executed.
  - Server performed graceful shutdown (`Received SIGTERM`, `Shutdown complete`).
  - Container rebooted and resumed healthcheck `healthy`.
  - User A credentials and created alert rule persisted 100% in SQLite database.
- **Online Backup:**
  - Executed `docker compose exec app node scripts/backup_db.mjs`.
  - Live non-blocking snapshot generated via `VACUUM INTO` in `/app/backups/`.
  - Snapshot verified on host mounted `./backups/` volume.
  - Restored database snapshot verified via `PRAGMA integrity_check;` returning `ok`.

---

## 4. Full Release Gate Test Results

| Command | Exit Code | Assertions / Output | Result |
|---|---|---|---|
| `pnpm typecheck:all` | 0 | Server & Client TypeScript compiled cleanly | PASS |
| `pnpm test:unit` | 0 | 100% unit tests passed in 485ms | PASS |
| `pnpm test:integration` | 0 | 100% integration tests passed in 3978ms | PASS |
| `pnpm verify:p0` | 0 | 13/13 P0 safeguards passed | PASS |
| `pnpm build:all` | 0 | Server clean build + Vite client bundle built (1954 modules transformed) | PASS |
| `pnpm test:e2e` | 0 | 19/19 Playwright assertions passed; deterministic teardown verified via `scripts/run_e2e.mjs` (0 remaining processes) | FULL PASS (RUNNER EXIT 0 VERIFIED) |
| `node scratch/staging_full_verification.mjs` | 0 | 42/42 Staging acceptance tests passed | PASS |

---

## 5. Vendor Status & Remaining Blockers

- **Databento Status:** `UNAVAILABLE` (Expected). Staging environment correctly operates in Fail-Closed mode with zero mock data and zero synthetic trade leaks.
- **Remaining Production Blockers:**
  1. Provisioning of production `DATABENTO_API_KEY` for live CME feed streaming.
  2. Provisioning of production Stripe live keys for billing subscription management.
  3. Operator sign-off for public domain DNS and production TLS issuance.

---

## 6. Final Recommendation

- **Staging Verdict:** **DOCKER STAGING VERIFIED**
- **Production Gate Verdict:** **CONDITIONAL RELEASE CANDIDATE**
- **Public Production Ready:** **NO** (blocked on live market data vendor credentials only).

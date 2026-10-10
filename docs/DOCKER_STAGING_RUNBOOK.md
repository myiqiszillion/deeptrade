# DOCKER STAGING RUNBOOK

This runbook provides step-by-step instructions for the Release Operator to boot and verify the DeepChart staging environment.

## A. Prerequisites

- **Docker Engine / Docker Desktop:** Version 24+ (Verified: Docker Desktop 4.94.0, Engine 29.8.2 on Linux amd64 WSL2).
- **Docker Compose:** V2 plugin installed (Verified: v5.5.1).
- **Architecture:** `amd64` (multi-arch supported by Alpine).
- **Resources:** At least 2GB RAM and 5GB free disk space.
- **Node/pnpm:** Not required for container execution (multi-stage Docker build handles all compilation).
- **Network Ports:** Port `80` and `443` available on the host for Caddy.

## B. Environment Setup

Create a `.env` file in the root directory based on `.env.example`.

Required variables:
- **For backend startup (Required):**
  - `AUTH_JWT_SECRET`: Must be a secure random string (minimum 32 chars). Generated dynamically for staging.
  - `AUTH_REQUIRED`: Set to `1` for production/staging enforcement.
  - `DOMAIN`: Set to `localhost` for local staging or a fully qualified domain for production.
- **For authentication (Required):**
  - `ADMIN_SECRET`: Used for administrative metrics/API access.
  - `METRICS_TOKEN`: Used for authenticated Prometheus metrics scraping.
- **For optional features (Vendor Dependent):**
  - `DATABENTO_API_KEY`: Leave empty for staging test; system runs in Fail-Closed `UNAVAILABLE` mode.
  - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`: Optional for billing tests.
  - `ENABLE_QUOTE_BOARD`: Set to `1` to enable watchlist quotes.

**Do not write secret values in documentation or logs.**

## C. Staging Boot & Execution

1. **Compose Config Validation:**
   ```bash
   docker compose config --quiet
   ```
2. **Image Build:**
   ```bash
   docker compose build
   ```
3. **Container Startup:**
   ```bash
   docker compose up -d
   ```
4. **Healthcheck Commands:**
   ```bash
   docker compose ps
   # Ensure 'app' shows 'Up (healthy)' and 'proxy' is 'Up'
   ```
5. **Log Inspection:**
   ```bash
   docker compose logs --tail 100
   ```

## D. API & Frontend Verification

1. **SPA Asset Checks:** Open `https://localhost` in browser. Verify UI loads, canvas mounts, no blocking CSP errors.
2. **API Health:** `curl.exe -k https://localhost/healthz` (returns `{"status":"ok", ...}`).
3. **Instruments Catalog:** `curl.exe -k https://localhost/api/v1/instruments` (returns 67 instruments).
4. **Metrics Protection:**
   - Unauthenticated: `curl.exe -k https://localhost/metrics` (returns 401 Unauthorized).
   - Authenticated: `curl.exe -k -H "Authorization: Bearer <METRICS_TOKEN>" https://localhost/metrics` (returns 200 with Prometheus stats).
5. **WebSocket Verification:**
   - Unauthenticated connection: rejected with code `1008` (Authentication required).
   - Authenticated connection via subprotocol: `new WebSocket('wss://localhost/', ['deepchart-token', token])` upgrades to 101 Switching Protocols.
   - Initial state message: receives `INIT_STATE` for `ES`.
   - Subscription switch: send `{"type":"SUBSCRIBE","symbol":"NQ"}` receives `INIT_STATE` for `NQ`.
   - PING/PONG: send `{"type":"PING"}` receives `{"type":"PONG"}`.

## E. Database Persistence & Backup/Restore

1. **Persistent Volume:** SQLite database is stored at `/app/data/market_data.sqlite` mapped to Docker volume `app-data`.
2. **WAL Mode:** Verified via `PRAGMA journal_mode;` returning `wal`.
3. **Data Retention Across Restart:**
   - Register a user or create an alert rule via API.
   - Restart container: `docker compose restart app`
   - Re-query user or alert rule to verify 100% data retention.
4. **Online Backup:**
   ```bash
   docker compose exec app node scripts/backup_db.mjs
   ```
   Snapshot is written via `VACUUM INTO` to `/app/backups/market_data-<timestamp>.sqlite` which maps to host `./backups/`.
5. **Integrity Check:**
   ```bash
   docker compose exec app node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('/app/backups/<snapshot_file>', { readOnly: true }); console.log(db.prepare('PRAGMA integrity_check;').get());"
   # Must return { integrity_check: 'ok' }
   ```

## F. Security Verification

1. **Path Protection:**
   - `https://localhost/.env` returns `404 Not Found`.
   - `https://localhost/market_data.sqlite` returns `404 Not Found`.
   - `https://localhost/backups` returns `404 Not Found`.
2. **Security Headers:**
   - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
   - `X-Frame-Options: DENY`
   - `X-Content-Type-Options: nosniff`
   - `Referrer-Policy: no-referrer`
   - `Server` header hidden.
3. **WebSocket Origin Policy:** Connection with non-whitelisted Origin header rejected with `1008 Origin not allowed`.
4. **User Isolation:** Users can only query and manage their own alerts and sessions.

## G. Automated Test Suite

Run the full automated staging test suite:
```bash
node scratch/staging_full_verification.mjs
# Verifies all 42 staging acceptance assertions in under 10 seconds.
```

## H. Teardown / Rollback

1. **Graceful Stop (retaining data):**
   ```bash
   docker compose stop
   ```
2. **Remove Containers (volume preserved):**
   ```bash
   docker compose down
   # CAUTION: Never run `docker compose down -v` to prevent volume deletion.
   ```

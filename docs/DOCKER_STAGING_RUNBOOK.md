# DOCKER STAGING RUNBOOK

This runbook provides step-by-step instructions for the Release Operator to boot and verify the DeepChart staging environment.

## A. Prerequisites

- **Docker Engine / Docker Desktop:** Version 24+ recommended.
- **Docker Compose:** V2 plugin installed (`docker compose version`).
- **Architecture:** `amd64` or `arm64` (multi-arch supported by Alpine).
- **Resources:** At least 2GB RAM and 5GB free disk space.
- **Node/pnpm:** Not required (multi-stage Docker build handles all compilation).
- **Network Ports:** Port `80` and `443` available on the host for Caddy.

## B. Environment Setup

Create a `.env` file in the root directory based on `.env.example`. 

Required variables:
- **For backend startup (Required):**
  - `AUTH_JWT_SECRET`: Must be a secure random string (minimum 32 chars).
  - `DOMAIN`: E.g., `localhost` or a real domain for TLS.
- **For authentication (Required):**
  - `ADMIN_SECRET`: Used for administrative metrics/API access.
- **For optional features (Optional):**
  - `DATABENTO_API_KEY`: Required for live market data (Vendor Data).
  - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`: Required for billing.
  - `METRICS_TOKEN`: Optional, required if accessing `/metrics` without Admin Secret.
  - `ENABLE_QUOTE_BOARD`: Set to `1` to enable watchlist quotes.

**Do not write secret values in documentation.**

## C. Staging Boot

1. **Compose Config Validation:**
   ```bash
   docker compose config -q
   ```
2. **Image Build:**
   ```bash
   docker compose build --no-cache
   ```
3. **Container Startup:**
   ```bash
   docker compose up -d
   ```
4. **Healthcheck Commands:**
   ```bash
   docker compose ps
   # Ensure 'app' and 'proxy' are both showing 'Up (healthy)'
   ```
5. **Log Inspection:**
   ```bash
   docker compose logs -f
   ```

## D. API & Frontend Verification

1. **SPA Asset Checks:** Open `https://localhost` (or `$DOMAIN`) in a browser. Ensure the UI loads.
2. **API Health:** `curl -k https://localhost/healthz` (should return 200 OK).
3. **Authentication Checks:** Attempt to subscribe to a symbol as guest, it should fail with `ENTITLEMENT_DENIED` or `UNAUTHORIZED`.
4. **WebSocket Connection Checks:** Use the browser network tab to ensure `/api/ws` upgrades successfully to 101 Switching Protocols.
5. **Caddy Proxy Routing:** Verify `/api/v1/instruments` returns a JSON array.
6. **CSP Verification:** Check browser console for any Content Security Policy blocking errors.
7. **Metrics Authorization:** `curl -k https://localhost/metrics` should return 401 Unauthorized unless authorized.

## E. Database Verification

1. **Persistent Volume:**
   ```bash
   docker volume inspect deepchart_app-data
   ```
2. **Database Startup & WAL Mode:**
   Inspect logs to verify `[Storage] Initialized SQLite database` and `PRAGMA journal_mode = WAL`.
3. **Graceful Shutdown & Container Restart:**
   ```bash
   docker compose restart app
   ```
   Verify logs indicate `Shutdown complete.` before restarting.
4. **Database Persistence:** Create an alert rule, restart the container, and verify the rule persists.
5. **Backup & Restore (Manual):**
   ```bash
   docker compose exec app node scripts/backup_db.mjs
   ```
   Check `./backups/` on the host. Restore by replacing `/app/data/market_data.sqlite` with the backup file.
6. **Integrity Check:**
   ```bash
   docker compose exec app sqlite3 /app/data/market_data.sqlite "PRAGMA integrity_check;"
   ```

## F. Security Verification

1. **No public .env exposure:** Ensure `https://localhost/.env` returns 404 or 403.
2. **No database exposure:** Ensure `https://localhost/market_data.sqlite` returns 404.
3. **No backup exposure:** Ensure `https://localhost/backups` returns 404.
4. **No metrics exposure without authorization:** `/metrics` requires token.
5. **No secrets in logs:** Review `docker compose logs` for any accidentally printed secrets.
6. **JWT validation:** Valid signatures are enforced on WebSocket and HTTP.
7. **User isolation:** Users can only view and manage their own alerts and sessions.
8. **WebSocket origin:** WebSocket validates `Origin` header based on `ALLOWED_ORIGINS`.

## G. Troubleshooting

- **Image build fails:** Ensure enough disk space and docker daemon is running.
- **Node runtime incompatible:** Handled by Docker image, verified as `node:24-alpine`.
- **SQLite permission denied:** Verify volume permissions or run `chown -R 1000:1000 data/` on host if needed.
- **Backend unhealthy:** Check logs for `AUTH_JWT_SECRET` missing (process exits immediately if not configured).
- **Caddy returns 502:** Wait 15s for the backend to pass the healthcheck.
- **WebSocket connection fails:** Check `DOMAIN` matches the requested host or update `ALLOWED_ORIGINS`.
- **SPA assets return 404:** Check `Caddy.Dockerfile` built the client successfully.
- **CSP blocks resources:** Verify CSP headers in `deploy/Caddyfile` or `index.ts`.
- **Database locked:** Usually indicates another process is accessing the volume or WAL failure. Restart container.
- **Feed unavailable:** Verify `DATABENTO_API_KEY` is valid.

## H. Rollback

1. **Stop services:**
   ```bash
   docker compose down
   ```
2. **Restore previous image version:** If tagged, change tag in compose file and run `docker compose up -d`.
3. **Preserve persistent volume:** `deepchart_app-data` is retained.
4. **Restore database backup if required:** Replace the sqlite DB in the volume mount with a backup if schema was corrupted.
5. **Verify health after rollback:** Run `docker compose ps` and `curl -k https://localhost/healthz`.

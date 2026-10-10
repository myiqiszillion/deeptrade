# RELEASE CHECKLIST

### Pre-Release Actions
- [x] Confirm tests pass (`typecheck:all`, `test:unit`, `test:integration`, `verify:p0`, `build:all`, `test:e2e`).
- [x] Generate `STAGING_RELEASE_MANIFEST.md` for exact commit hash mapping.
- [x] Freeze code changes.

### Staging Validation (Docker Operator Actions - VERIFIED)
- [x] Run `docker compose build` on staging environment (`deepchart-app`, `deepchart-proxy`).
- [x] Deploy containers using `docker compose up -d`.
- [x] Confirm Caddy serves traffic securely over HTTPS/HTTP properly routed (308 redirect, HSTS, CSP).
- [x] Loopback network binding verified (`127.0.0.1:80`, `127.0.0.1:443`).
- [x] Confirm backend API & WebSocket connections are healthy via reverse proxy (`/healthz`, `/api/v1/instruments`, `wss://localhost/`).
- [x] Validate Databento streaming logic with actual entitlements (Fail-Closed `UNAVAILABLE` verified without key; vendor stream pending live key).
- [x] Confirm database reads/writes persist across container reboots (Users, alerts persist in WAL mode).
- [x] Review performance overhead within container constraints (Idle baseline ~25MB app, ~19MB proxy; CPU < 4%; sustained 24h production profiling deferred to post-launch monitoring).
- [x] Execute WAL-safe online backup (`VACUUM INTO` via `scripts/backup_db.mjs`) and verify `PRAGMA integrity_check` on snapshot (Verified `ok`; raw file copy prohibited).
- [x] Stripe webhook event-level idempotency verified (`webhook_events` audit table, deduplication by `event.id`, rejection of out-of-order stale events).

### Go / No-Go Decision
- [x] Staging acceptance gates cleared? (YES - 42/42 tests pass).
- [ ] Vendor credentials provisioned? (NO - Databento API key pending).
- [ ] Sign-off by Principal Engineer?
- [ ] Sign-off by Release Manager?

### Production Rollout (Pending Vendor Unblock)
- [ ] Inject production secrets (`AUTH_JWT_SECRET`, `ADMIN_SECRET`, `DATABENTO_API_KEY`, `STRIPE_*`).
- [ ] Merge Staging into Production branch.
- [ ] Create Git Tag for version release.
- [ ] Deploy identical Docker images to Production environment.
- [ ] Execute post-deploy smoke tests.
- [ ] Monitor metrics (Event loop lag, Memory RSS, Error rate) closely for the first 24 hours.

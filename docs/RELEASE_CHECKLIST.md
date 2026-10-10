# RELEASE CHECKLIST

### Pre-Release Actions
- [ ] Confirm tests pass (Unit, Integration, E2E, P0).
- [ ] Generate `STAGING_RELEASE_MANIFEST.md` for exact commit hash mapping.
- [ ] Freeze code changes.

### Staging Validation (Operator Actions)
- [ ] Run `docker compose build --no-cache` on staging server.
- [ ] Deploy containers using `docker compose up -d`.
- [ ] Confirm Caddy serves traffic securely over HTTPS/HTTP properly routed.
- [ ] Confirm backend API & WebSocket connections are healthy.
- [ ] Validate Databento streaming logic with actual entitlements.
- [ ] Confirm database reads/writes persist across container reboots.
- [ ] Review performance overhead within container constraints.

### Go / No-Go Decision
- [ ] All blockers resolved?
- [ ] Sign-off by Principal Engineer?
- [ ] Sign-off by Release Manager?

### Production Rollout
- [ ] Merge Staging into Production branch.
- [ ] Create Git Tag for version release.
- [ ] Deploy identical Docker images to Production environment.
- [ ] Execute post-deploy smoke tests.
- [ ] Monitor metrics (Event loop lag, Memory RSS, Error rate) closely for the first 24 hours.

# DOCKER STAGING RUNBOOK

This runbook is intended for the Release Operator to perform Phase 6 Staging validations, as Docker is unavailable in the automated testing environment.

## PREREQUISITES
1. A Linux/macOS or WSL2 staging machine with `docker` and `docker-compose` installed.
2. A staging `.env` file containing test credentials (NO production keys).
3. The codebase positioned at the CONDITIONAL RELEASE CANDIDATE commit hash (see `STAGING_RELEASE_MANIFEST.md`).

## STEP 1: DOCKER BUILD VALIDATION
Run the following from the repository root:
```bash
docker compose build --no-cache
```
**Expected Outcome:**
- Multi-stage build succeeds.
- No secrets leaked in build logs.
- Client React SPA and Server Node.js build without warnings.

## STEP 2: STAGING BOOT
```bash
docker compose up -d
docker compose ps
```
**Expected Outcome:**
- Caddy, server, and any supporting containers show status `Up`.
- `docker compose logs -f server` shows the DeepChart Server successfully started and bound to the correct port.

## STEP 3: CADDY ROUTING & SMOKE TESTS
1. Open a browser and navigate to `http://localhost`.
2. **Verify:** React SPA loads successfully.
3. Open Developer Tools -> Network tab.
4. **Verify:** No 404 errors for JS/CSS assets.
5. Attempt to login or access a chart.
6. **Verify:** `/api/v1/*` requests route successfully to the backend.
7. **Verify:** WebSocket upgrades successfully at `ws://localhost/api/v1/stream`.

## STEP 4: SQLITE PERSISTENCE
1. Make a structural change in the application (e.g., create an Alert Rule).
2. Stop the containers: `docker compose down`
3. Start the containers again: `docker compose up -d`
4. **Verify:** The Alert Rule is still present (confirming the volume mount works).

## STEP 5: VENDOR DATA (Databento)
If you have a Databento Staging API key:
1. Update your `.env` with `DATABENTO_API_KEY_LIVE`.
2. Restart the server.
3. Load an instrument chart (e.g., `ES`).
4. **Verify:** Historical bars and MBO/MBP data load.
5. **Verify:** Databento Live WebSocket streams tick data to the client correctly.

## STEP 6: DISASTER RECOVERY & ROLLBACK
- Test full disk scenarios if possible.
- Ensure you have a backup of your `staging_data` folder before making irreversible changes.
- Rollback consists of shutting down the containers and rolling back the git hash to the previous stable release, then `docker compose up -d --build`.

## SIGN-OFF
Once all steps are verified and perform gracefully, the release can be promoted from CONDITIONAL RELEASE CANDIDATE to RELEASE CANDIDATE READY.

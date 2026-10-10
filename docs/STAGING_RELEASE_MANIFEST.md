# STAGING RELEASE MANIFEST

## RELEASE IDENTIFIER
- **Commit Hash:** `aa52998e966b16a6451857ab6fcb12db8e2dc3a2`
- **Release Status:** CONDITIONAL RELEASE CANDIDATE (Pending Staging Validation)
- **Target Environment:** Docker Staging

## BASELINE CONDITIONS
This release incorporates the codebase at the commit above **PLUS** the following uncommitted changes that have been verified locally during Phase 5.7:

### Tracked Files Modified (Uncommitted)
- `client/src/App.tsx`
- `client/src/components/Chart/CVDPanel.tsx`
- `client/src/components/Chart/FootprintCanvas.tsx`
- `client/src/components/Chart/SecondaryChartPane.tsx`
- `client/src/components/DOM/LiquidityHeatmapWidget.tsx`
- `client/src/components/Navigation/ChartToolbar.tsx`
- `client/src/services/websocket.ts`
- `client/src/types/index.ts`
- `client/vite.config.ts`
- `deploy/Caddyfile`
- `docker-compose.yml`
- `docs/DEPLOY.md`
- `docs/STATUS.md`
- `e2e/terminal.spec.ts`
- `scripts/benchmark_baseline.ts`
- `scripts/benchmark_phase4.ts`
- `server/src/chart/chartService.ts`
- `server/src/chart/routes.ts`
- `server/src/gexEngine.ts`
- `server/src/index.ts`
- `server/src/marketData/databentoHistoryProvider.ts`
- `server/src/marketData/marketContext.ts`
- `server/src/session.ts`
- `server/src/storage/marketDataStore.ts`
- `server/src/types.ts`
- `server/src/verify_p0.ts`
- `server/test/integration/index.ts`
- `server/test/integration/websocket.test.ts`
- `server/test/unit/chartRoutes.test.ts`
- `server/test/unit/depthStorage.test.ts`
- `server/test/unit/footprintEngine.test.ts`

### Untracked Files Added
- `deploy/Caddy.Dockerfile`
- `docs/DOCKER_STAGING_RUNBOOK.md`
- `docs/EXECUTION_PLAN.md`
- `docs/KNOWN_LIMITATIONS.md`
- `docs/PHASE_5.6_RELEASE_REPORT.md`
- `docs/PRODUCTION_READINESS.md`
- `docs/RELEASE_CHECKLIST.md`
- `docs/STAGING_REPORT.md`
- `e2e/memory.spec.ts`
- `scripts/validate_staging_db.ts`
- `server/test/integration/alertDelivery.test.ts`
- `server/test/integration/depthPersistence.test.ts`

### Excluded from Release Build
- `.env` files and local credentials (untracked and ignored)
- Local SQLite database files (`*.sqlite`, `*.db`) inside `staging_data/` or root
- Developer scratch files (`scratch/`)
- Playwright/Test artifacts (`test-results/`)

*Note: As Docker is not installed in the local environment, Docker-based validations are BLOCKED and must be executed by the release operator.*

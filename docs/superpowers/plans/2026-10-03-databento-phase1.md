# Phase 1: Databento Data Layer & Ingestion Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completely remove Unusual Whales and build a high-performance Databento Data Layer supporting real-time WebSocket streaming, historical data ingestion, multi-asset normalization (Stocks, Options, Futures), TimescaleDB hypertables, and Redis caching.

**Architecture:** A modular Databento client module (`DatabentoHttpClient` + `DatabentoLiveClient` + `DatabentoNormalizer`) feeds a micro-batched ingestion buffer (`BatchIngestionQueue`), persisting into TimescaleDB hypertables and Redis memory cache via a pluggable `IMarketDataStore` interface with SQLite/in-memory fallback for hermetic offline testing.

**Tech Stack:** Node.js 22+, TypeScript, WebSocket (`ws`), PostgreSQL + TimescaleDB, Redis, SQLite (`node:sqlite`).

**Spec:** [docs/superpowers/specs/2026-10-03-databento-phase1-design.md](file:///c:/Users/Administrator/Documents/deepchart/docs/superpowers/specs/2026-10-03-databento-phase1-design.md)

## Global Constraints
- Zero external network calls during unit/integration tests (`pnpm test` must run hermetically offline).
- Complete, clean-cut removal of Unusual Whales: zero references to `unusualwhales` or `UW_API_KEY` left in codebase.
- Maintain strict fail-closed behavior: never fabricate ticks, book levels, or synthetic quotes if vendor data is unavailable.
- Node.js >= 22.5 compatibility (support native `node:sqlite` and ESM).

## Review Focus
1. **Unusual Whales Residuals**: Any lingering UW route, import, or widget causing runtime 404 or compilation error.
2. **Databento Authentication Failure**: Missing or malformed `DATABENTO_API_KEY` must gracefully emit `UNAVAILABLE` status without crashing.
3. **OPRA Symbol Parsing**: Correctly format and parse OSI option symbols (e.g. `SPY260320C00500000`) into underlying, strike, expiration, and right.
4. **Database Reconnect / Offline Resilience**: If PostgreSQL or Redis is unreachable, fallback cleanly to local store without throwing unhandled exceptions.
5. **Ingestion Queue Backpressure**: High-frequency ticks must be bounded in buffer memory and flushed in micro-batches without blocking the Node.js event loop.

---

### Task 1: Clean-Cut Removal of Unusual Whales

**Files:**
- Delete: `c:/Users/Administrator/Documents/deepchart/.agents/skills/unusual-whales-market-intelligence/SKILL.md`
- Delete: `c:/Users/Administrator/Documents/deepchart/server/src/marketData/uwRoutes.ts`
- Delete: `c:/Users/Administrator/Documents/deepchart/server/src/marketData/unusualWhalesAdapter.ts`
- Delete: `c:/Users/Administrator/Documents/deepchart/server/src/marketData/unusualWhalesHistory.ts`
- Delete: `c:/Users/Administrator/Documents/deepchart/client/src/components/Options/UWExplorerWidget.tsx`
- Modify: `c:/Users/Administrator/Documents/deepchart/server/src/index.ts`
- Modify: `c:/Users/Administrator/Documents/deepchart/server/src/marketData/registry.ts`
- Modify: `c:/Users/Administrator/Documents/deepchart/server/src/marketData/quoteBoard.ts`
- Modify: `c:/Users/Administrator/Documents/deepchart/server/src/marketData/marketContext.ts`
- Modify: `c:/Users/Administrator/Documents/deepchart/client/src/components/Navigation/WorkspaceDock.tsx`
- Modify: `c:/Users/Administrator/Documents/deepchart/client/src/App.tsx`
- Modify: `c:/Users/Administrator/Documents/deepchart/client/src/components/Options/GEXPanel.tsx`
- Modify: `c:/Users/Administrator/Documents/deepchart/client/src/components/Options/OptionsFlowWidget.tsx`
- Modify: `c:/Users/Administrator/Documents/deepchart/server/test/unit/quoteBoard.test.ts`
- Modify: `c:/Users/Administrator/Documents/deepchart/server/test/unit/entitlement.test.ts`
- Modify: `c:/Users/Administrator/Documents/deepchart/server/test/unit/regression_audit.test.ts`
- Modify: `c:/Users/Administrator/Documents/deepchart/.env.example`

- [x] **Step 1: Delete Unusual Whales workspace skill and files**
  Delete `.agents/skills/unusual-whales-market-intelligence/SKILL.md`, `server/src/marketData/uwRoutes.ts`, `server/src/marketData/unusualWhalesAdapter.ts`, `server/src/marketData/unusualWhalesHistory.ts`, and `client/src/components/Options/UWExplorerWidget.tsx`.

- [x] **Step 2: Clean up server router, imports, and registry**
  In `server/src/index.ts`, remove `handleUwRoutes` import and `/api/v1/uw/` route handler.
  In `server/src/marketData/registry.ts`, replace `unusualwhales` with `databento`.
  In `server/src/marketData/quoteBoard.ts` and `marketContext.ts`, replace Unusual Whales history calls with vendor-agnostic / databento stubs.

- [x] **Step 3: Clean up client navigation and widgets**
  In `WorkspaceDock.tsx` and `App.tsx`, remove `UWExplorerWidget` references.
  In `GEXPanel.tsx` and `OptionsFlowWidget.tsx`, point API calls from `/api/v1/uw/*` to `/api/v1/options/*`.

- [x] **Step 4: Update test suites referencing Unusual Whales**
  In `quoteBoard.test.ts`, `entitlement.test.ts`, and `regression_audit.test.ts`, update provider expectations from `unusualwhales` to `databento`.

- [x] **Step 5: Run tests to verify clean compilation and passing test suite**
  Run `pnpm test` and verify that all unit/integration tests pass with zero UW dependencies.

---

### Task 2: Databento Normalization Models & Test Fixtures

**Files:**
- Create: `c:/Users/Administrator/Documents/deepchart/server/src/databento/types.ts`
- Create: `c:/Users/Administrator/Documents/deepchart/server/src/databento/normalizer.ts`
- Create: `c:/Users/Administrator/Documents/deepchart/server/test/fixtures/databento/trades_equity.json`
- Create: `c:/Users/Administrator/Documents/deepchart/server/test/fixtures/databento/quotes_options.json`
- Create: `c:/Users/Administrator/Documents/deepchart/server/test/fixtures/databento/definitions_options.json`
- Create: `c:/Users/Administrator/Documents/deepchart/server/test/fixtures/databento/statistics_options.json`
- Create: `c:/Users/Administrator/Documents/deepchart/server/test/unit/databentoNormalizer.test.ts`
- Modify: `c:/Users/Administrator/Documents/deepchart/server/test/unit/index.ts`

- [x] **Step 1: Define Databento data interfaces**
  In `server/src/databento/types.ts`, define `NormalizedTrade`, `NormalizedQuote`, `OptionContractDefinition`, `OptionStatisticRecord`, and Databento raw schema interfaces (`DbTradesRecord`, `DbMbp1Record`, `DbDefinitionRecord`, `DbStatisticsRecord`).

- [x] **Step 2: Create mock fixture files**
  Create recorded fixture JSON files under `server/test/fixtures/databento/` for equity trades, option quotes (NBBO), option definitions, and daily statistics.

- [x] **Step 3: Write failing unit test for normalizer**
  In `server/test/unit/databentoNormalizer.test.ts`, write tests verifying:
  - Trade normalization: price scaling (fixed-point 1e9), size, buy/sell side classification from action/flags.
  - Option quote normalization: bid/ask price, bid/ask size, timestamp conversion.
  - OSI option contract symbol parsing (e.g. `SPY260320C00500000` -> SPY, 2026-03-20, Call, $500).
  - Daily statistic normalization: open interest and volume extraction.

- [x] **Step 4: Implement DatabentoNormalizer**
  In `server/src/databento/normalizer.ts`, implement `normalizeTrade`, `normalizeQuote`, `normalizeDefinition`, `normalizeStatistic`, and `parseOsiSymbol`.

- [x] **Step 5: Run normalizer tests and verify green**
  Register in `server/test/unit/index.ts` and run `pnpm test:unit`.

---

### Task 3: Databento HTTP Client (Historical REST & Symbology)

**Files:**
- Create: `c:/Users/Administrator/Documents/deepchart/server/src/databento/client.ts`
- Create: `c:/Users/Administrator/Documents/deepchart/server/test/unit/databentoClient.test.ts`
- Modify: `c:/Users/Administrator/Documents/deepchart/server/test/unit/index.ts`

- [x] **Step 1: Write failing unit tests for DatabentoHttpClient**
  In `databentoClient.test.ts`, write tests using a mock fetch function testing:
  - Correct Basic Auth header formatting (`Basic base64(apiKey + ":")`).
  - `getHistoricalBars`: querying `/v0/timeseries.get_range` with `schema=ohlcv-1m`.
  - `getHistoricalTrades`: querying `/v0/timeseries.get_range` with `schema=trades`.
  - `getOptionDefinitions`: querying `/v0/timeseries.get_range` with `schema=definition`.
  - `getStatistics`: querying `/v0/timeseries.get_range` with `schema=statistics`.
  - Error handling: HTTP 401 (invalid key), HTTP 429 (rate limit), and network timeout.

- [x] **Step 2: Implement DatabentoHttpClient**
  In `server/src/databento/client.ts`, implement `DatabentoHttpClient` class with configured baseURL, timeouts, retry logic for 429s, and typed responses.

- [x] **Step 3: Run client tests and verify green**
  Register in `server/test/unit/index.ts` and run `pnpm test:unit`.

---

### Task 4: Databento Realtime Live Streaming WebSocket Client

**Files:**
- Create: `c:/Users/Administrator/Documents/deepchart/server/src/databento/liveClient.ts`
- Create: `c:/Users/Administrator/Documents/deepchart/server/test/unit/databentoLive.test.ts`
- Modify: `c:/Users/Administrator/Documents/deepchart/server/test/unit/index.ts`

- [x] **Step 1: Write failing unit test for DatabentoLiveClient**
  In `databentoLive.test.ts`, mock the WebSocket connection to test:
  - Connection lifecycle: connecting -> challenge response -> authenticated -> live.
  - Subscribing to dataset (`OPRA.PILLAR` or `GLBX.MDP3`) with schema (`trades`, `mbp-1`).
  - Handling inbound trade records and calling `handlers.onTrade`.
  - Handling inbound depth records and calling `handlers.onDepth`.
  - Reconnect on unexpected disconnect with exponential backoff.
  - Graceful disconnect on `disconnect()`.

- [x] **Step 2: Implement DatabentoLiveClient**
  In `server/src/databento/liveClient.ts`, implement `DatabentoLiveClient` conforming to `MarketDataFeed` interface.

- [x] **Step 3: Run live client tests and verify green**
  Register in `server/test/unit/index.ts` and run `pnpm test:unit`.

---

### Task 5: Ingestion Micro-Batching & Multi-Tier Storage (TimescaleDB + Redis + SQLite Fallback)

**Files:**
- Create: `c:/Users/Administrator/Documents/deepchart/server/src/storage/types.ts`
- Create: `c:/Users/Administrator/Documents/deepchart/server/src/storage/timescaleStore.ts`
- Create: `c:/Users/Administrator/Documents/deepchart/server/src/storage/redisCache.ts`
- Create: `c:/Users/Administrator/Documents/deepchart/server/src/databento/batchIngestion.ts`
- Modify: `c:/Users/Administrator/Documents/deepchart/server/src/storage/marketDataStore.ts`
- Create: `c:/Users/Administrator/Documents/deepchart/server/test/unit/batchIngestion.test.ts`
- Create: `c:/Users/Administrator/Documents/deepchart/server/test/unit/databentoStorage.test.ts`
- Modify: `c:/Users/Administrator/Documents/deepchart/server/test/unit/index.ts`

- [x] **Step 1: Define IMarketDataStore interface**
  In `server/src/storage/types.ts`, define the unified interface `IMarketDataStore` covering trades, quotes, option contracts, statistics, and bars.

- [x] **Step 2: Implement BatchIngestionQueue**
  In `server/src/databento/batchIngestion.ts`, implement queue with configurable batch size (default 500) and max wait time (default 250ms). Write unit tests in `batchIngestion.test.ts` to verify auto-flush and batching.

- [x] **Step 3: Implement TimescaleStore & RedisCache with mock fallback**
  In `server/src/storage/timescaleStore.ts`, implement TimescaleDB hypertable queries and migrations.
  In `server/src/storage/redisCache.ts`, implement Redis quote/chain caching.
  In `server/src/storage/marketDataStore.ts`, adapt the existing SQLite store to implement `IMarketDataStore` so that offline tests run hermetically.

- [x] **Step 4: Run storage unit tests and verify green**
  Register in `server/test/unit/index.ts` and run `pnpm test:unit`.

---

### Task 6: Wire Databento into DeepChart Server, Registry & APIs

**Files:**
- Modify: `c:/Users/Administrator/Documents/deepchart/server/src/marketData/registry.ts`
- Modify: `c:/Users/Administrator/Documents/deepchart/server/src/marketData/marketContext.ts`
- Modify: `c:/Users/Administrator/Documents/deepchart/server/src/marketData/quoteBoard.ts`
- Modify: `c:/Users/Administrator/Documents/deepchart/server/src/index.ts`
- Modify: `c:/Users/Administrator/Documents/deepchart/.env.example`
- Create: `c:/Users/Administrator/Documents/deepchart/server/src/marketData/optionsRoutes.ts`
- Modify: `c:/Users/Administrator/Documents/deepchart/server/test/integration/historyApi.test.ts`

- [x] **Step 1: Update registry and feed factory**
  In `registry.ts`, register `databento` as the primary futures and options provider. Wire `DatabentoLiveClient` for realtime feeds.

- [x] **Step 2: Update MarketContext history fetching**
  In `marketContext.ts`, replace legacy bar fetching with `DatabentoHttpClient.getHistoricalBars`.

- [x] **Step 3: Add new Options REST API endpoints**
  Create `server/src/marketData/optionsRoutes.ts` providing:
  - `/api/v1/options/contracts?underlying=SPY`
  - `/api/v1/options/chain?underlying=SPY&expiry=...`
  - `/api/v1/options/quotes?symbols=...`
  Mount in `server/src/index.ts`.

- [x] **Step 4: Update .env.example with Databento variables**
  Add `DATABENTO_API_KEY`, `DATABENTO_LIVE_URL`, `DATABENTO_HIST_URL`, `DATABASE_URL` (TimescaleDB), `REDIS_URL`.

- [x] **Step 5: Run integration tests and verify green**
  Run `pnpm test:integration`.

---

### Task 7: Full Verification & Zero-Legacy Audit

**Files:**
- All workspace files

- [x] **Step 1: Run complete test suite**
  Execute `pnpm test` (protocol check, unit tests, integration tests, client bundle check).

- [x] **Step 2: Zero-Legacy Grep Audit**
  Run regex search for `unusualwhales` / `unusual_whales` across all TypeScript, TSX, Markdown, and config files to confirm 100% clean-cut elimination.

- [x] **Step 3: Verify client build**
  Run `pnpm --filter client build` to confirm frontend builds cleanly without missing imports or assets.

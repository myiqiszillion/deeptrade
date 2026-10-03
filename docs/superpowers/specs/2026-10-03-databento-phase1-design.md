# DeepChart — Phase 1: Databento Data Layer & Ingestion Engine Design Spec

## 1. Executive Summary & Objectives
DeepChart is migrating completely away from Unusual Whales to **Databento** as the sole institutional market data provider.
The objective of **Phase 1** is to build a rock-solid, production-grade **Data Layer**:
- Complete removal of Unusual Whales (adapters, history, routes, UI widgets, workspace skills).
- Databento API integration:
  - Historical REST API (`/v0/timeseries.get_range`, `/v0/symbology.resolve`, `/v0/metadata.*`).
  - Realtime Live Streaming via WebSocket (`wss://live.databento.com/v0/ws`).
- Multi-asset normalization (Stocks, ETFs, US Options OPRA, CME Futures GLBX).
- High-throughput storage:
  - **PostgreSQL + TimescaleDB** hypertables for tick-level trades, quotes, and aggregated bars.
  - **Redis** memory cache for active NBBO quotes, chain indices, and pub/sub streaming.
  - **Pluggable adapter (`IMarketDataStore`)** with SQLite in-memory fallback for hermetic unit testing.

---

## 2. Deprecation of Unusual Whales (Clean-Cut)

### 2.1 Workspace Skills & Docs
- Delete `.agents/skills/unusual-whales-market-intelligence/` directory and `SKILL.md`.
- Update `README.md` and `docs/STATUS.md` removing all references to Unusual Whales.

### 2.2 Server Components
- Delete `server/src/marketData/uwRoutes.ts` and remove `/api/v1/uw/` route handler from `server/src/index.ts`.
- Delete `server/src/marketData/unusualWhalesAdapter.ts` and `server/src/marketData/unusualWhalesHistory.ts`.
- Update `server/src/marketData/registry.ts`:
  - Replace `UnusualWhalesFeed` with `DatabentoFeed`.
  - Set `FUTURES_PROVIDER=databento`, `OPTIONS_PROVIDER=databento`.
- Update `server/src/marketData/quoteBoard.ts`:
  - Fetch watchlist quotes via Databento market quotes instead of Unusual Whales.
- Update tests referencing `unusualwhales`:
  - `server/test/unit/quoteBoard.test.ts`
  - `server/test/unit/entitlement.test.ts`
  - `server/test/unit/regression_audit.test.ts`

### 2.3 Client Components
- Delete `client/src/components/Options/UWExplorerWidget.tsx`.
- Update `client/src/components/Navigation/WorkspaceDock.tsx` and `client/src/App.tsx`:
  - Remove Unusual Whales explorer button and modal.
  - Retain dock layout, prepare slot for upcoming Databento Options Chain / Flow Dashboard.
- Update `client/src/components/Options/GEXPanel.tsx` and `client/src/components/Options/OptionsFlowWidget.tsx`:
  - Point to `/api/v1/options/` and `/api/v1/gex/` endpoints.

---

## 3. Databento Client Architecture

### 3.1 Datasets & Asset Classes
| Asset Class | Databento Dataset | Schemas Used | Example Symbols |
|---|---|---|---|
| **Equities & ETFs** | `DBEQ.BASIC` / `XNAS.ITCH` | `trades`, `mbp-1`, `ohlcv-1m` | SPY, QQQ, AAPL, NVDA, TSLA |
| **US Equity Options** | `OPRA.PILLAR` | `trades`, `tbbo` / `mbp-1`, `definition`, `statistics` | SPY.OPT, QQQ.OPT, AAPL.OPT |
| **CME Futures** | `GLBX.MDP3` | `trades`, `mbp-1`, `ohlcv-1m`, `definition`, `statistics` | ES.FUT, NQ.FUT, CL.FUT, GC.FUT |
| **Indices** | `DBEQ.BASIC` / `XNAS.ITCH` | `ohlcv-1m`, `trades` | SPX, NDX, VIX |

### 3.2 Authentication & Configuration
Environment variables:
```bash
DATABENTO_API_KEY=db-xxxxxxxxxxxxxxxxxxxx
DATABENTO_HIST_URL=https://hist.databento.com
DATABENTO_LIVE_URL=wss://live.databento.com/v0/ws
DATABENTO_EQUITIES_DATASET=DBEQ.BASIC
DATABENTO_OPTIONS_DATASET=OPRA.PILLAR
DATABENTO_FUTURES_DATASET=GLBX.MDP3
```
Databento HTTP Basic authentication:
- `Authorization: Basic base64(DATABENTO_API_KEY + ":")`

### 3.3 Historical HTTP Client (`DatabentoHttpClient`)
Path: `server/src/databento/client.ts`
Methods:
- `getHistoricalBars(dataset, symbols, schema, start, end, limit)`: Fetches `ohlcv-1s`, `ohlcv-1m`, `ohlcv-1d`.
- `getHistoricalTrades(dataset, symbols, start, end, limit)`: Fetches historical `trades`.
- `getHistoricalQuotes(dataset, symbols, start, end, limit)`: Fetches historical `mbp-1` / `tbbo`.
- `getOptionDefinitions(underlying, expirationDate)`: Fetches all contract strikes, rights (call/put), expirations, multipliers from `definition` schema.
- `getStatistics(dataset, symbols, start, end)`: Fetches Open Interest and settlement values.
- `resolveSymbology(dataset, symbols, stypeIn, stypeOut)`: Maps OSI option symbology (e.g. `SPY260320C00500000`) or raw instrument IDs.

### 3.4 Live WebSocket Client (`DatabentoLiveClient`)
Path: `server/src/databento/liveClient.ts`
Features:
- Connects to `wss://live.databento.com/v0/ws`.
- Challenge-response auth handshake:
  - Gateway sends auth challenge `c-xxxx`.
  - Client responds with `key=DATABENTO_API_KEY|auth=bucket_hash`.
- Subscription frame:
  ```json
  {
    "dataset": "OPRA.PILLAR",
    "schema": "trades",
    "symbols": ["SPY.OPT"],
    "stype_in": "parent"
  }
  ```
- Subscriptions for:
  - `trades` (trade price, size, timestamp)
  - `mbp-1` (top of book: bid/ask price and size)
  - `statistics` (daily open interest updates)
- Automatic heartbeat maintenance and reconnect backoff logic with status notification (`LIVE`, `CONNECTING`, `UNAVAILABLE`).

---

## 4. Normalization Layer (`DatabentoNormalizer`)

Path: `server/src/databento/normalizer.ts`
Standardized models:
```typescript
export interface NormalizedTrade {
  symbol: string;
  underlying?: string;
  price: number;
  size: number;
  side: 'buy' | 'sell' | 'cross' | 'unknown';
  timestamp: number; // ms
  timestampNs: bigint;
  tradeId?: string;
  action?: 'A' | 'C' | 'M';
}

export interface NormalizedQuote {
  symbol: string;
  underlying?: string;
  bidPrice: number;
  askPrice: number;
  bidSize: number;
  askSize: number;
  timestamp: number;
}

export interface OptionContractDefinition {
  contractSymbol: string; // OSI format: SPY260320C00500000
  underlying: string;     // SPY
  expiration: string;     // YYYY-MM-DD
  strike: number;         // 500.0
  optionType: 'call' | 'put';
  multiplier: number;     // 100
  instrumentId: number;   // Databento instrument ID
}

export interface OptionStatisticRecord {
  contractSymbol: string;
  openInterest: number;
  volume: number;
  settlementPrice?: number;
  timestamp: number;
}
```

---

## 5. Storage Architecture (PostgreSQL + TimescaleDB + Redis)

### 5.1 Pluggable Storage Interface (`IMarketDataStore`)
Path: `server/src/storage/marketDataStore.ts`
Both `TimescaleDataStore` and `SqliteDataStore` implement:
- `insertTrades(trades: NormalizedTrade[]): Promise<void>`
- `insertQuotes(quotes: NormalizedQuote[]): Promise<void>`
- `insertOptionContracts(contracts: OptionContractDefinition[]): Promise<void>`
- `insertStatistics(stats: OptionStatisticRecord[]): Promise<void>`
- `queryBars(options: BarQueryOptions): Promise<BarQueryResult>`
- `queryTrades(options: TradeQueryOptions): Promise<TradeQueryResult>`
- `queryOptionChain(underlying: string, expiration?: string): Promise<OptionContractDefinition[]>`

### 5.2 TimescaleDB Schema
```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS market_trades (
  time TIMESTAMPTZ NOT NULL,
  symbol VARCHAR(64) NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  size DOUBLE PRECISION NOT NULL,
  side VARCHAR(8) NOT NULL,
  dataset VARCHAR(32) NOT NULL
);
SELECT create_hypertable('market_trades', 'time', if_not_exists => TRUE);
CREATE INDEX ON market_trades (symbol, time DESC);

CREATE TABLE IF NOT EXISTS market_quotes (
  time TIMESTAMPTZ NOT NULL,
  symbol VARCHAR(64) NOT NULL,
  bid_price DOUBLE PRECISION,
  ask_price DOUBLE PRECISION,
  bid_size DOUBLE PRECISION,
  ask_size DOUBLE PRECISION
);
SELECT create_hypertable('market_quotes', 'time', if_not_exists => TRUE);
CREATE INDEX ON market_quotes (symbol, time DESC);

CREATE TABLE IF NOT EXISTS option_contracts (
  contract_symbol VARCHAR(64) PRIMARY KEY,
  underlying VARCHAR(16) NOT NULL,
  expiration DATE NOT NULL,
  strike DOUBLE PRECISION NOT NULL,
  option_type VARCHAR(4) NOT NULL,
  multiplier INT DEFAULT 100,
  instrument_id BIGINT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON option_contracts (underlying, expiration, strike);

CREATE TABLE IF NOT EXISTS option_statistics (
  time TIMESTAMPTZ NOT NULL,
  contract_symbol VARCHAR(64) NOT NULL,
  open_interest BIGINT,
  volume BIGINT,
  settlement_price DOUBLE PRECISION
);
SELECT create_hypertable('option_statistics', 'time', if_not_exists => TRUE);
CREATE INDEX ON option_statistics (contract_symbol, time DESC);
```

### 5.3 Micro-Batching Ingestion Engine
Path: `server/src/databento/batchIngestion.ts`
- Buffered queue in memory: flushes every 250ms or when buffer hits 500 records.
- Prevents database connection thrashing and allows 100,000+ ticks/minute throughput.

### 5.4 Redis Cache Strategy
Path: `server/src/storage/redisCache.ts`
- `quote:{symbol}`: JSON `{ bid, ask, bidSize, askSize, lastTrade, time }` with TTL 60s.
- `chain:{underlying}:expirations`: Set of available expiration dates.
- `chain:{underlying}:{expiration}`: Sorted set of contracts by strike.
- `oi:{contract_symbol}`: Open Interest integer.
- `pubsub:trades` & `pubsub:quotes`: Redis channels for inter-process broadcasting.

---

## 6. Verification & Testing Strategy
1. **Mock Fixture System**:
   - `server/test/fixtures/databento/`:
     - Recorded JSON/DBN responses for `trades`, `mbp-1`, `definition`, and `statistics`.
2. **Unit Tests**:
   - `databentoClient.test.ts`: Verify HTTP auth, URL building, and error handling with mock fetch.
   - `databentoLive.test.ts`: Verify WebSocket challenge-response and message decoding.
   - `databentoNormalizer.test.ts`: Verify exact conversion of equities, options, and futures ticks.
   - `batchIngestion.test.ts`: Verify micro-batch buffering, flushing, and backpressure.
3. **Integration & Regression Tests**:
   - Ensure `pnpm test` (unit, integration, client check) passes cleanly with zero regressions.
   - Verify that all Unusual Whales references are 100% eliminated from the codebase.

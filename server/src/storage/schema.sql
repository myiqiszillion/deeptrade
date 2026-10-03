-- ==========================================================
-- DeepChart & Databento Storage Schema (TimescaleDB / PostgreSQL)
-- ==========================================================

CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- 1. Historical & Realtime OHLCV Bars
CREATE TABLE IF NOT EXISTS market_bars (
    time TIMESTAMPTZ NOT NULL,
    provider VARCHAR(32) NOT NULL,
    symbol VARCHAR(64) NOT NULL,
    timeframe VARCHAR(16) NOT NULL,
    open DOUBLE PRECISION NOT NULL,
    high DOUBLE PRECISION NOT NULL,
    low DOUBLE PRECISION NOT NULL,
    close DOUBLE PRECISION NOT NULL,
    volume DOUBLE PRECISION NOT NULL,
    CONSTRAINT pk_market_bars PRIMARY KEY (symbol, timeframe, time, provider)
);
SELECT create_hypertable('market_bars', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_market_bars_lookup ON market_bars (symbol, timeframe, time DESC);

-- 2. Realtime and Historical Trades
CREATE TABLE IF NOT EXISTS market_trades (
    time TIMESTAMPTZ NOT NULL,
    provider VARCHAR(32) NOT NULL,
    symbol VARCHAR(64) NOT NULL,
    price DOUBLE PRECISION NOT NULL,
    size DOUBLE PRECISION NOT NULL,
    side VARCHAR(16) NOT NULL,
    trade_id VARCHAR(64),
    source_provider VARCHAR(32)
);
SELECT create_hypertable('market_trades', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_market_trades_lookup ON market_trades (symbol, time DESC);

-- 3. Options Contract Definitions (OPRA.PILLAR)
CREATE TABLE IF NOT EXISTS option_definitions (
    symbol VARCHAR(64) PRIMARY KEY,
    underlying VARCHAR(16) NOT NULL,
    expiration DATE NOT NULL,
    expiration_ts BIGINT NOT NULL,
    type VARCHAR(8) NOT NULL,
    strike DOUBLE PRECISION NOT NULL,
    multiplier INT NOT NULL DEFAULT 100,
    dte INT,
    instrument_id INT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_option_definitions_underlying ON option_definitions (underlying, expiration, strike);

-- 4. Daily Options Statistics (Open Interest, Settlement, Volume)
CREATE TABLE IF NOT EXISTS option_statistics (
    time TIMESTAMPTZ NOT NULL,
    symbol VARCHAR(64) NOT NULL,
    open_interest BIGINT,
    settlement_price DOUBLE PRECISION,
    cleared_volume BIGINT,
    CONSTRAINT pk_option_stats PRIMARY KEY (symbol, time)
);
SELECT create_hypertable('option_statistics', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_option_stats_lookup ON option_statistics (symbol, time DESC);

import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { FootprintBar, HistoricalBar, Tick } from '../types.js';
import { MarketTrade } from '../marketData/types.js';
import { Entitlement, User } from '../auth/types.js';
import { OptionContractDefinition, OptionStatisticRecord } from '../databento/types.js';
import { IMarketDataStore, DepthSnapshotInput, DepthQueryOptions, DepthQueryResult } from './types.js';
import { encodeDepthLevels, decodeDepthLevels } from './depthCodec.js';
import { AlertRule, AlertHistoryItem } from '../alerts/types.js';

export interface BarQueryOptions {
  provider: string;
  symbol: string;
  timeframe: string;
  beforeTime?: number;
  limit?: number;
}

export interface BarQueryResult {
  bars: HistoricalBar[];
  hasMore: boolean;
  cursor?: {
    provider: string;
    symbol: string;
    timeframe: string;
    beforeTime: number;
  };
}

export interface TradeQueryOptions {
  provider: string;
  symbol: string;
  beforeTime?: number;
  beforeId?: string;
  limit?: number;
}

export interface TradeQueryResult {
  trades: Tick[];
  hasMore: boolean;
  cursor?: {
    provider: string;
    symbol: string;
    beforeTime: number;
    beforeId: string;
  };
}

interface GapRecord {
  id: number;
  symbol: string;
  provider: string;
  fromTs: number;
  toTs: number;
  reason: string;
  createdAt: number;
}

/** Instrument spec as stored from a vendor definition record (`schema=definition`). */
export interface InstrumentSpecRow {
  root: string;
  rawSymbol: string;
  exchange: string;
  currency: string;
  instrumentClass: string;
  pointValue: number;
  tickSize: number;
  tickValue: number;
  unitOfMeasure?: string;
  unitOfMeasureQty?: number;
  underlying?: string;
  activation?: string;
  expiration?: string;
  updatedAt?: number;
}

export class MarketDataStore implements IMarketDataStore {
  private db: DatabaseSync;
  private dbPath: string;
  private insertTradeStmt: any;
  private insertBarStmt: any;
  private insertGapStmt: any;
  private insertOptionDefStmt: any;
  private insertOptionStatStmt: any;
  private insertDepthStmt: any;
  private depthWriteQueue: DepthSnapshotInput[] = [];
  private readonly maxDepthQueueSize = 5000;
  private depthSamplingIntervalMs = Number(process.env.DEPTH_SAMPLING_INTERVAL_MS) || 250;
  private lastDepthSampleBySymbol = new Map<string, number>();
  private depthFlushTimer: any = null;
  private writeFailures = 0;
  private lastWriteWarningTs = 0;
  private depthQueueOverflows = 0;

  constructor(dbPath?: string) {
    let resolvedPath = dbPath;
    if (!resolvedPath) {
      if (process.env.STORAGE_PATH) {
        // Keep SQLite's ':memory:' sentinel intact: path.resolve() would rewrite it into a real
        // file path (e.g. C:\app\:memory:), which fails to open — and crashes the server at boot.
        const configuredPath = process.env.STORAGE_PATH.trim();
        resolvedPath = configuredPath === ':memory:' ? ':memory:' : resolve(configuredPath);
      } else if (process.env.NODE_ENV === 'test') {
        resolvedPath = ':memory:';
      } else {
        const dataDir = resolve(process.cwd(), 'data');
        mkdirSync(dataDir, { recursive: true });
        resolvedPath = resolve(dataDir, 'market_data.sqlite');
      }
    }

    if (resolvedPath !== ':memory:') {
      const parentDir = resolve(resolvedPath, '..');
      mkdirSync(parentDir, { recursive: true });
    }

    this.db = new DatabaseSync(resolvedPath);
    this.dbPath = resolvedPath;
    this.initSchema();

    this.depthFlushTimer = setInterval(() => {
      this.flushDepthQueue();
    }, 500);
    if (this.depthFlushTimer && typeof this.depthFlushTimer.unref === 'function') {
      this.depthFlushTimer.unref();
    }
  }

  private initSchema(): void {
    // Enable Write-Ahead Logging (WAL) for high concurrency and performance
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA temp_store = MEMORY;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS trades (
        provider TEXT NOT NULL,
        symbol TEXT NOT NULL,
        trade_id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        price REAL NOT NULL,
        size REAL NOT NULL,
        side TEXT NOT NULL,
        aggressor_provenance TEXT,
        receive_ts INTEGER,
        sequence_id TEXT,
        source_provider TEXT,
        is_coalesced INTEGER DEFAULT 0,
        PRIMARY KEY (provider, symbol, trade_id)
      );

      CREATE INDEX IF NOT EXISTS idx_trades_query_scoped ON trades(provider, symbol, ts DESC, trade_id DESC);
      -- Retention deletes scan by ts alone: without this the chunked purge full-scans the table per batch.
      CREATE INDEX IF NOT EXISTS idx_trades_ts ON trades(ts);

      CREATE TABLE IF NOT EXISTS bars (
        provider TEXT NOT NULL,
        symbol TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        time INTEGER NOT NULL,
        open REAL NOT NULL,
        high REAL NOT NULL,
        low REAL NOT NULL,
        close REAL NOT NULL,
        volume REAL NOT NULL,
        buy_volume REAL,
        sell_volume REAL,
        delta REAL,
        is_partial INTEGER DEFAULT 0,
        PRIMARY KEY (provider, symbol, timeframe, time)
      );

      CREATE INDEX IF NOT EXISTS idx_bars_query_scoped ON bars(provider, symbol, timeframe, time DESC);

      CREATE TABLE IF NOT EXISTS gaps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        provider TEXT NOT NULL,
        from_ts INTEGER NOT NULL,
        to_ts INTEGER NOT NULL,
        reason TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_gaps_lookup ON gaps(symbol, from_ts DESC);
      CREATE INDEX IF NOT EXISTS idx_gaps_to_ts ON gaps(to_ts);

      -- Metered vendor spend ledger. One row per provider+month so a restart cannot silently forget the total.
      CREATE TABLE IF NOT EXISTS vendor_usage (
        provider TEXT NOT NULL,
        month TEXT NOT NULL,
        usd REAL NOT NULL DEFAULT 0,
        requests INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (provider, month)
      );

      -- Instrument specs pulled from the vendor's definition schema (schema=definition). One row per root:
      -- this is what lets the app serve every product of a dataset without hand-typed contract specs.
      CREATE TABLE IF NOT EXISTS instrument_specs (
        provider TEXT NOT NULL,
        root TEXT NOT NULL,
        raw_symbol TEXT NOT NULL,
        exchange TEXT NOT NULL,
        currency TEXT NOT NULL,
        instrument_class TEXT NOT NULL,
        point_value REAL NOT NULL,
        tick_size REAL NOT NULL,
        tick_value REAL NOT NULL,
        unit_of_measure TEXT,
        unit_of_measure_qty REAL,
        underlying TEXT,
        activation TEXT,
        expiration TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (provider, root)
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        password_hash TEXT,
        updated_at INTEGER
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);

      CREATE TABLE IF NOT EXISTS subscriptions (
        user_id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        status TEXT NOT NULL,
        current_period_end INTEGER NOT NULL,
        provider TEXT NOT NULL,
        provider_ref TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS entitlements (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        exchange TEXT,
        symbol_pattern TEXT,
        data_types TEXT NOT NULL,
        valid_until INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_entitlements_user ON entitlements(user_id, valid_until);

      CREATE TABLE IF NOT EXISTS revoked_tokens (
        jti TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_revoked_tokens_exp ON revoked_tokens(expires_at);

      CREATE TABLE IF NOT EXISTS option_definitions (
        symbol TEXT PRIMARY KEY,
        underlying TEXT NOT NULL,
        expiration TEXT NOT NULL,
        expiration_ts INTEGER NOT NULL,
        type TEXT NOT NULL,
        strike REAL NOT NULL,
        multiplier INTEGER NOT NULL DEFAULT 100,
        dte INTEGER,
        instrument_id INTEGER,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_option_defs_underlying ON option_definitions(underlying, expiration, strike);

      CREATE TABLE IF NOT EXISTS option_statistics (
        symbol TEXT NOT NULL,
        time INTEGER NOT NULL,
        open_interest INTEGER,
        settlement_price REAL,
        cleared_volume INTEGER,
        PRIMARY KEY (symbol, time)
      );

      CREATE INDEX IF NOT EXISTS idx_option_stats_symbol ON option_statistics(symbol, time DESC);

      CREATE TABLE IF NOT EXISTS exposure_snapshots (
        underlying TEXT NOT NULL,
        asOf INTEGER NOT NULL,
        spot REAL NOT NULL,
        totals TEXT NOT NULL,
        walls TEXT NOT NULL,
        levels TEXT NOT NULL,
        gammaFlip REAL,
        regime TEXT NOT NULL,
        dataSource TEXT NOT NULL,
        PRIMARY KEY (underlying, asOf)
      );
      CREATE INDEX IF NOT EXISTS idx_exposure_underlying ON exposure_snapshots(underlying, asOf DESC);

      CREATE TABLE IF NOT EXISTS instrument_master (
        instrument_id INTEGER PRIMARY KEY,
        dataset TEXT NOT NULL,
        publisher_id INTEGER NOT NULL,
        raw_symbol TEXT NOT NULL,
        security_type TEXT NOT NULL,
        asset TEXT NOT NULL,
        underlying TEXT,
        exchange TEXT NOT NULL,
        venue TEXT,
        activation TEXT,
        expiration TEXT,
        strike REAL,
        option_type TEXT,
        currency TEXT NOT NULL DEFAULT 'USD',
        tick_size REAL NOT NULL,
        multiplier INTEGER NOT NULL DEFAULT 1,
        figi TEXT, isin TEXT, cusip TEXT,
        parent_instrument_id INTEGER,
        is_continuous INTEGER NOT NULL DEFAULT 0,
        continuous_root TEXT,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_master_dataset ON instrument_master(dataset, asset);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_master_raw ON instrument_master(dataset, raw_symbol);

      CREATE TABLE IF NOT EXISTS raw_manifest (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dataset TEXT NOT NULL,
        schema TEXT NOT NULL,
        symbols TEXT,
        date TEXT NOT NULL,
        file_path TEXT NOT NULL UNIQUE,
        format TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        checksum TEXT NOT NULL,
        fetched_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS depth_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        exchange_ts INTEGER NOT NULL,
        receive_ts INTEGER NOT NULL,
        sequence_number INTEGER,
        schema_version INTEGER DEFAULT 1,
        data_source TEXT DEFAULT 'live',
        session_id TEXT,
        levels_blob BLOB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_depth_symbol_ts ON depth_snapshots (symbol, exchange_ts ASC);
      CREATE INDEX IF NOT EXISTS idx_depth_receive_ts ON depth_snapshots (receive_ts);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_depth_symbol_seq ON depth_snapshots (symbol, sequence_number) WHERE sequence_number IS NOT NULL;

      CREATE TABLE IF NOT EXISTS alert_rules (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        type TEXT NOT NULL,
        threshold REAL NOT NULL,
        timeframe TEXT NOT NULL DEFAULT '1m',
        cooldown_sec INTEGER NOT NULL DEFAULT 60,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        last_triggered_at INTEGER,
        metadata TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_alert_rules_user ON alert_rules(user_id);
      CREATE INDEX IF NOT EXISTS idx_alert_rules_symbol ON alert_rules(symbol, enabled);

      CREATE TABLE IF NOT EXISTS alert_history (
        id TEXT PRIMARY KEY,
        rule_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        type TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'INFO',
        message TEXT NOT NULL,
        price REAL,
        trigger_time INTEGER NOT NULL,
        acknowledged INTEGER NOT NULL DEFAULT 0,
        metadata TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_alert_history_user ON alert_history(user_id, trigger_time DESC);

      CREATE TABLE IF NOT EXISTS webhook_events (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        event_type TEXT NOT NULL,
        user_id TEXT,
        outcome TEXT NOT NULL,
        processed_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_webhook_events_user ON webhook_events(user_id);
    `);

    // Databases created before real accounts existed need the credential columns added.
    this.ensureColumn('users', 'password_hash', 'TEXT');
    this.ensureColumn('users', 'updated_at', 'INTEGER');
    try {
      this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)');
    } catch {
      // Pre-existing duplicate usernames: keep running, lookups just fall back to the first match.
    }

    this.insertTradeStmt = this.db.prepare(`
      INSERT OR IGNORE INTO trades (
        provider, symbol, trade_id, ts, price, size, side,
        aggressor_provenance, receive_ts, sequence_id, source_provider, is_coalesced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.insertBarStmt = this.db.prepare(`
      INSERT OR REPLACE INTO bars (
        provider, symbol, timeframe, time, open, high, low, close,
        volume, buy_volume, sell_volume, delta, is_partial
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.insertGapStmt = this.db.prepare(`
      INSERT INTO gaps (symbol, provider, from_ts, to_ts, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    this.insertOptionDefStmt = this.db.prepare(`
      INSERT OR REPLACE INTO option_definitions (
        symbol, underlying, expiration, expiration_ts, type, strike, multiplier, dte, instrument_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.insertOptionStatStmt = this.db.prepare(`
      INSERT OR REPLACE INTO option_statistics (
        symbol, time, open_interest, settlement_price, cleared_volume
      ) VALUES (?, ?, ?, ?, ?)
    `);

    this.insertDepthStmt = this.db.prepare(`
      INSERT OR IGNORE INTO depth_snapshots (
        symbol, exchange_ts, receive_ts, sequence_number, schema_version, data_source, session_id, levels_blob
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  /**
   * Persistence failures are reported (rate limited) instead of thrown: every write path holds the
   * SQLite lock briefly, and a single SQLITE_BUSY must not take the whole feed process down.
   */
  /** Additive migrations for databases created before a column existed. */
  private ensureColumn(table: string, column: string, definition: string): void {
    try {
      const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      if (rows.some((r) => r.name === column)) return;
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    } catch (err) {
      console.warn(`[MarketDataStore] migration ${table}.${column} failed: ${(err as Error).message}`);
    }
  }

  private warnWriteFailure(op: string, err: unknown): void {
    this.writeFailures++;
    const now = Date.now();
    if (now - this.lastWriteWarningTs > 5000) {
      this.lastWriteWarningTs = now;
      console.warn(
        `[MarketDataStore] ${op} failed: ${(err as Error).message} (${this.writeFailures} write failure(s) so far; this batch was not persisted)`
      );
    }
  }

  /**
   * Batch insert trades into the persistent store. Deduplication is enforced by PRIMARY KEY (provider, symbol, trade_id).
   */
  public saveTrades(trades: (MarketTrade | Tick)[], symbol: string, provider: string): void {
    if (trades.length === 0) return;

    try {
      for (const t of trades) {
        const ts = 'ts' in t ? t.ts : t.timestamp;
        const tradeId = 'id' in t && t.id ? t.id : `t_${ts}_${t.price}_${t.size}`;
        const receiveTs = t.receiveTs ?? Date.now();
        const seqId = t.sequenceId !== undefined ? String(t.sequenceId) : null;
        const srcProvider = t.sourceProvider || provider;
        const isCoalesced = t.qualityFlags?.isCoalesced ? 1 : 0;

        const rawSide = typeof t.side === 'string' ? t.side.toLowerCase() : 'unknown';
        const side = rawSide === 'buy' || rawSide === 'b' ? 'buy' : rawSide === 'sell' || rawSide === 'a' ? 'sell' : 'unknown';

        this.insertTradeStmt.run(
          provider,
          symbol,
          tradeId,
          ts,
          t.price,
          t.size,
          side,
          t.aggressorProvenance || 'UNKNOWN',
          receiveTs,
          seqId,
          srcProvider,
          isCoalesced
        );
      }
    } catch (err) {
      // A transient SQLite error (e.g. SQLITE_BUSY while another writer holds the lock) must never
      // escape into the feed's trade handler: an uncaught throw there kills the whole server.
      this.warnWriteFailure(`saveTrades(${provider}/${symbol}, ${trades.length} trades)`, err);
    }
  }

  public saveTrade(trade: MarketTrade, symbol: string, provider: string): void {
    this.saveTrades([trade], symbol, provider);
  }

  public saveTradesBatch(trades: MarketTrade[], symbol: string, provider: string): void {
    this.saveTrades(trades, symbol, provider);
  }

  public saveOptionDefinitions(definitions: OptionContractDefinition[]): void {
    if (definitions.length === 0) return;
    try {
      const now = Date.now();
      for (const d of definitions) {
        this.insertOptionDefStmt.run(
          d.symbol,
          d.underlying,
          d.expiration,
          d.expirationTimestamp,
          d.type,
          d.strike,
          d.multiplier ?? 100,
          d.dte ?? null,
          d.instrumentId ?? null,
          now
        );
      }
    } catch (err) {
      this.warnWriteFailure(`saveOptionDefinitions(${definitions.length} defs)`, err);
    }
  }

  public getOptionDefinitions(underlying: string): OptionContractDefinition[] {
    try {
      const rows = this.db.prepare(`
        SELECT symbol, underlying, expiration, expiration_ts, type, strike, multiplier, dte, instrument_id
        FROM option_definitions
        WHERE underlying = ?
        ORDER BY expiration_ts ASC, strike ASC
      `).all(underlying.toUpperCase()) as any[];

      return rows.map((r) => ({
        symbol: r.symbol,
        underlying: r.underlying,
        expiration: r.expiration,
        expirationTimestamp: r.expiration_ts,
        type: r.type,
        strike: r.strike,
        multiplier: r.multiplier,
        dte: r.dte,
        instrumentId: r.instrument_id ?? undefined,
      }));
    } catch (err) {
      this.warnWriteFailure(`getOptionDefinitions(${underlying})`, err);
      return [];
    }
  }

  public saveStatistics(stats: OptionStatisticRecord[]): void {
    if (stats.length === 0) return;
    try {
      for (const s of stats) {
        this.insertOptionStatStmt.run(
          s.symbol,
          s.timestamp,
          s.openInterest ?? null,
          s.settlementPrice ?? null,
          s.clearedVolume ?? null
        );
      }
    } catch (err) {
      this.warnWriteFailure(`saveStatistics(${stats.length} stats)`, err);
    }
  }

  public getLatestStatistics(symbol: string): OptionStatisticRecord | null {
    try {
      const row = this.db.prepare(`
        SELECT symbol, time, open_interest, settlement_price, cleared_volume
        FROM option_statistics
        WHERE symbol = ?
        ORDER BY time DESC
        LIMIT 1
      `).get(symbol) as any;

      if (!row) return null;
      return {
        symbol: row.symbol,
        timestamp: row.time,
        openInterest: row.open_interest ?? undefined,
        settlementPrice: row.settlement_price ?? undefined,
        clearedVolume: row.cleared_volume ?? undefined,
      };
    } catch (err) {
      this.warnWriteFailure(`getLatestStatistics(${symbol})`, err);
      return null;
    }
  }

  /**
   * Save a single bar into the persistent store.
   */
  public saveBar(
    bar: FootprintBar | HistoricalBar,
    symbol: string,
    timeframe: string,
    provider: string
  ): void {
    try {
      this.insertBarStmt.run(
        provider,
        symbol,
        timeframe,
        bar.time,
        bar.open,
        bar.high,
        bar.low,
        bar.close,
        bar.volume,
        bar.buyVolume ?? null,
        bar.sellVolume ?? null,
        bar.delta ?? null,
        'isPartial' in bar && bar.isPartial ? 1 : 0
      );
    } catch (err) {
      this.warnWriteFailure(`saveBar(${provider}/${symbol}/${timeframe} @ ${bar.time})`, err);
    }
  }

  /**
   * Batch insert historical bars.
   * Supports both (bars, symbol, timeframe, provider) and (provider, symbol, timeframe, bars) signatures.
   */
  public saveBars(bars: HistoricalBar[], symbol: string, timeframe: string, provider: string): void;
  public saveBars(provider: string, symbol: string, timeframe: string, bars: HistoricalBar[]): void;
  public saveBars(
    arg1: HistoricalBar[] | string,
    arg2: string,
    arg3: string,
    arg4: HistoricalBar[] | string
  ): void {
    if (Array.isArray(arg1)) {
      const bars = arg1;
      const symbol = arg2;
      const timeframe = arg3;
      const provider = arg4 as string;
      for (const b of bars) {
        this.saveBar(b, symbol, timeframe, provider);
      }
    } else {
      const provider = arg1;
      const symbol = arg2;
      const timeframe = arg3;
      const bars = arg4 as HistoricalBar[];
      for (const b of bars) {
        this.saveBar(b, symbol, timeframe, provider);
      }
    }
  }

  /**
   * Query historical bars descending by open time with provider-scoped filtering.
   * Returns bars in ASCENDING chronological order for chart rendering.
   */
  public queryBars(options: BarQueryOptions): BarQueryResult {
    const { provider, symbol, timeframe } = options;
    const limit = Math.min(Math.max(options.limit ?? 300, 1), 1000);
    const beforeTime = options.beforeTime ?? Number.MAX_SAFE_INTEGER;

    const stmt = this.db.prepare(`
      SELECT time, open, high, low, close, volume, buy_volume, sell_volume, delta, is_partial
      FROM bars
      WHERE provider = ? AND symbol = ? AND timeframe = ? AND time < ?
      ORDER BY time DESC
      LIMIT ?
    `);

    const rows = stmt.all(provider, symbol, timeframe, beforeTime, limit + 1) as Array<{
      time: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      buy_volume: number | null;
      sell_volume: number | null;
      delta: number | null;
      is_partial: number;
    }>;

    const hasMore = rows.length > limit;
    const resultRows = hasMore ? rows.slice(0, limit) : rows;

    const bars: HistoricalBar[] = resultRows.map((r) => {
      const b: HistoricalBar = {
        time: Number(r.time),
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volume: Number(r.volume),
      };
      if (r.buy_volume !== null && r.buy_volume !== undefined) b.buyVolume = Number(r.buy_volume);
      if (r.sell_volume !== null && r.sell_volume !== undefined) b.sellVolume = Number(r.sell_volume);
      if (r.delta !== null && r.delta !== undefined) b.delta = Number(r.delta);
      if (r.is_partial) b.isPartial = true;
      return b;
    });

    bars.sort((a, b) => a.time - b.time);

    const cursor = bars.length > 0 ? {
      provider,
      symbol,
      timeframe,
      beforeTime: bars[0].time,
    } : undefined;

    return {
      bars,
      hasMore,
      cursor,
    };
  }

  /**
   * Query historical bars in a specific time range [startTime, endTime].
   * Returns bars in ASCENDING chronological order.
   */
  public queryBarsRange(options: {
    provider?: string;
    symbol: string;
    timeframe: string;
    startTime: number;
    endTime: number;
    limit?: number;
  }): HistoricalBar[] {
    const { provider, symbol, timeframe, startTime, endTime } = options;
    const limit = Math.min(Math.max(options.limit ?? 2000, 1), 10000);

    const sql = provider
      ? `SELECT time, open, high, low, close, volume, buy_volume, sell_volume, delta, is_partial
         FROM bars
         WHERE provider = ? AND symbol = ? AND timeframe = ? AND time >= ? AND time <= ?
         ORDER BY time ASC
         LIMIT ?`
      : `SELECT time, open, high, low, close, volume, buy_volume, sell_volume, delta, is_partial
         FROM bars
         WHERE symbol = ? AND timeframe = ? AND time >= ? AND time <= ?
         ORDER BY time ASC
         LIMIT ?`;

    const args = provider
      ? [provider, symbol, timeframe, startTime, endTime, limit]
      : [symbol, timeframe, startTime, endTime, limit];

    const rows = this.db.prepare(sql).all(...args) as Array<{
      time: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      buy_volume: number | null;
      sell_volume: number | null;
      delta: number | null;
      is_partial: number;
    }>;

    return rows.map((r) => {
      const b: HistoricalBar = {
        time: Number(r.time),
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volume: Number(r.volume),
      };
      if (r.buy_volume !== null && r.buy_volume !== undefined) b.buyVolume = Number(r.buy_volume);
      if (r.sell_volume !== null && r.sell_volume !== undefined) b.sellVolume = Number(r.sell_volume);
      if (r.delta !== null && r.delta !== undefined) b.delta = Number(r.delta);
      if (r.is_partial) b.isPartial = true;
      return b;
    });
  }

  /**
   * Query historical trades in a specific time range [startTime, endTime].
   * Returns ticks in ASCENDING chronological order.
   */
  public queryTradesRange(options: {
    provider?: string;
    symbol: string;
    startTime: number;
    endTime: number;
    limit?: number;
  }): Tick[] {
    const { provider, symbol, startTime, endTime } = options;
    const limit = Math.min(Math.max(options.limit ?? 5000, 1), 50000);

    const sql = provider
      ? `SELECT trade_id, ts, price, size, side, aggressor_provenance, receive_ts, sequence_id, source_provider, is_coalesced
         FROM trades
         WHERE provider = ? AND symbol = ? AND ts >= ? AND ts <= ?
         ORDER BY ts ASC, trade_id ASC
         LIMIT ?`
      : `SELECT trade_id, ts, price, size, side, aggressor_provenance, receive_ts, sequence_id, source_provider, is_coalesced
         FROM trades
         WHERE symbol = ? AND ts >= ? AND ts <= ?
         ORDER BY ts ASC, trade_id ASC
         LIMIT ?`;

    const args = provider
      ? [provider, symbol, startTime, endTime, limit]
      : [symbol, startTime, endTime, limit];

    const rows = this.db.prepare(sql).all(...args) as Array<{
      trade_id: string;
      ts: number;
      price: number;
      size: number;
      side: string;
      aggressor_provenance: string | null;
      receive_ts: number | null;
      sequence_id: string | null;
      source_provider: string | null;
      is_coalesced: number;
    }>;

    return rows.map((r) => ({
      id: r.trade_id,
      timestamp: Number(r.ts),
      price: Number(r.price),
      size: Number(r.size),
      side: (r.side?.toLowerCase() === 'buy' ? 'buy' : r.side?.toLowerCase() === 'sell' ? 'sell' : 'unknown') as 'buy' | 'sell' | 'unknown',
      receiveTs: r.receive_ts ? Number(r.receive_ts) : undefined,
      aggressorProvenance: r.aggressor_provenance as any,
      sequenceId: r.sequence_id ?? undefined,
      sourceProvider: r.source_provider ?? undefined,
      qualityFlags: r.is_coalesced ? { isCoalesced: true } : undefined,
    }));
  }

  /**
   * Query historical trades with provider-scoped composite cursor (beforeTime, beforeId).
   */
  public queryTrades(options: TradeQueryOptions): TradeQueryResult {
    const { provider, symbol } = options;
    const limit = Math.min(Math.max(options.limit ?? 500, 1), 5000);
    const beforeTime = options.beforeTime ?? Number.MAX_SAFE_INTEGER;
    const beforeId = options.beforeId ?? '';

    const sql = `
      SELECT trade_id, ts, price, size, side, aggressor_provenance, receive_ts, sequence_id, source_provider, is_coalesced
      FROM trades
      WHERE provider = ? AND symbol = ? AND (ts < ? OR (ts = ? AND trade_id < ?))
      ORDER BY ts DESC, trade_id DESC
      LIMIT ?
    `;

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(provider, symbol, beforeTime, beforeTime, beforeId, limit + 1) as Array<{
      trade_id: string;
      ts: number;
      price: number;
      size: number;
      side: string;
      aggressor_provenance: string | null;
      receive_ts: number | null;
      sequence_id: string | null;
      source_provider: string | null;
      is_coalesced: number;
    }>;

    const hasMore = rows.length > limit;
    const resultRows = hasMore ? rows.slice(0, limit) : rows;

    const trades: Tick[] = resultRows.map((r) => ({
      id: r.trade_id,
      timestamp: Number(r.ts),
      price: Number(r.price),
      size: Number(r.size),
      side: (r.side?.toLowerCase() === 'buy' ? 'buy' : r.side?.toLowerCase() === 'sell' ? 'sell' : 'unknown') as 'buy' | 'sell' | 'unknown',
      receiveTs: r.receive_ts ? Number(r.receive_ts) : undefined,
      aggressorProvenance: r.aggressor_provenance as any,
      sequenceId: r.sequence_id ?? undefined,
      sourceProvider: r.source_provider ?? undefined,
      qualityFlags: r.is_coalesced ? { isCoalesced: true } : undefined,
    }));

    trades.sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    const oldest = trades.length > 0 ? trades[0] : undefined;
    const cursor = oldest ? {
      provider,
      symbol,
      beforeTime: oldest.timestamp,
      beforeId: oldest.id,
    } : undefined;

    return {
      trades,
      hasMore,
      cursor,
    };
  }

  /**
   * Record a detected gap in market data.
   */
  public recordGap(symbol: string, provider: string, fromTs: number, toTs: number, reason: string): void {
    try {
      this.insertGapStmt.run(symbol, provider, fromTs, toTs, reason, Date.now());
    } catch (err) {
      this.warnWriteFailure(`recordGap(${provider}/${symbol})`, err);
    }
  }

  /**
   * Get recorded gaps within a timestamp window.
   */
  public getGaps(symbol: string, fromTs = 0, toTs = Number.MAX_SAFE_INTEGER): GapRecord[] {
    const stmt = this.db.prepare(`
      SELECT id, symbol, provider, from_ts, to_ts, reason, created_at
      FROM gaps
      WHERE symbol = ? AND to_ts >= ? AND from_ts <= ?
      ORDER BY from_ts ASC
    `);

    const rows = stmt.all(symbol, fromTs, toTs) as Array<{
      id: number;
      symbol: string;
      provider: string;
      from_ts: number;
      to_ts: number;
      reason: string;
      created_at: number;
    }>;

    return rows.map((r) => ({
      id: Number(r.id),
      symbol: r.symbol,
      provider: r.provider,
      fromTs: Number(r.from_ts),
      toTs: Number(r.to_ts),
      reason: r.reason,
      createdAt: Number(r.created_at),
    }));
  }

  // User Management

  /**
   * Insert or update a user without destroying credential columns.
   * (INSERT OR REPLACE would delete the row first and wipe password_hash.)
   */
  public saveUser(user: User): void {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO users (id, username, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        username = excluded.username,
        role = excluded.role,
        status = excluded.status,
        updated_at = excluded.updated_at
    `);
    stmt.run(user.id, user.username, user.role, user.status, now, now);
  }

  public setUserPassword(userId: string, passwordHash: string): void {
    const stmt = this.db.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`);
    stmt.run(passwordHash, Date.now(), userId);
  }

  public getUser(id: string): User | null {
    const stmt = this.db.prepare(`SELECT id, username, role, status FROM users WHERE id = ?`);
    const row = stmt.get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      username: row.username,
      role: row.role,
      status: row.status,
    };
  }

  public findUserByUsername(username: string): User | null {
    const stmt = this.db.prepare(`SELECT id, username, role, status FROM users WHERE lower(username) = lower(?) LIMIT 1`);
    const row = stmt.get(username) as any;
    if (!row) return null;
    return { id: row.id, username: row.username, role: row.role, status: row.status };
  }

  /** Credential lookup used by the login endpoint (never exposed to clients). */
  public getUserCredentials(idOrUsername: string): { user: User; passwordHash: string | null } | null {
    const stmt = this.db.prepare(
      `SELECT id, username, role, status, password_hash FROM users WHERE id = ? OR lower(username) = lower(?) LIMIT 1`
    );
    const row = stmt.get(idOrUsername, idOrUsername) as any;
    if (!row) return null;
    return {
      user: { id: row.id, username: row.username, role: row.role, status: row.status },
      passwordHash: row.password_hash ?? null,
    };
  }

  /** GDPR-style hard delete: the account, its entitlements, subscription and nonces go away. */
  public deleteUser(userId: string): void {
    const run = (sql: string) => {
      try {
        this.db.prepare(sql).run(userId);
      } catch (err) {
        this.warnWriteFailure(`deleteUser(${userId})`, err);
      }
    };
    run('DELETE FROM users WHERE id = ?');
    run('DELETE FROM entitlements WHERE user_id = ?');
    run('DELETE FROM subscriptions WHERE user_id = ?');
  }

  // Subscription Management

  public saveSubscription(subscription: {
    userId: string;
    planId: string;
    status: string;
    currentPeriodEnd: number;
    provider: string;
    providerRef?: string;
    createdAt: number;
    updatedAt: number;
  }): void {
    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO subscriptions
          (user_id, plan_id, status, current_period_end, provider, provider_ref, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        subscription.userId,
        subscription.planId,
        subscription.status,
        subscription.currentPeriodEnd,
        subscription.provider,
        subscription.providerRef ?? null,
        subscription.createdAt,
        subscription.updatedAt
      );
    } catch (err) {
      this.warnWriteFailure(`saveSubscription(${subscription.userId})`, err);
    }
  }

  public getSubscription(userId: string): {
    userId: string;
    planId: string;
    status: string;
    currentPeriodEnd: number;
    provider: string;
    providerRef?: string;
    createdAt: number;
    updatedAt: number;
  } | null {
    try {
      const row = this.db
        .prepare(
          `SELECT user_id, plan_id, status, current_period_end, provider, provider_ref, created_at, updated_at
           FROM subscriptions WHERE user_id = ?`
        )
        .get(userId) as any;
      if (!row) return null;
      return {
        userId: row.user_id,
        planId: row.plan_id,
        status: row.status,
        currentPeriodEnd: Number(row.current_period_end),
        provider: row.provider,
        providerRef: row.provider_ref ?? undefined,
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
      };
    } catch {
      return null;
    }
  }

  /** User ids with a subscription (used by the admin listing). */
  public listSubscriptions(): Array<{ userId: string; planId: string; status: string; currentPeriodEnd: number }> {
    try {
      const rows = this.db
        .prepare(`SELECT user_id, plan_id, status, current_period_end FROM subscriptions ORDER BY updated_at DESC LIMIT 5000`)
        .all() as any[];
      return rows.map((r) => ({
        userId: r.user_id,
        planId: r.plan_id,
        status: r.status,
        currentPeriodEnd: Number(r.current_period_end),
      }));
    } catch {
      return [];
    }
  }

  // Webhook Event Idempotency & Audit Trail

  public hasWebhookEvent(id: string): boolean {
    try {
      const row = this.db.prepare('SELECT id FROM webhook_events WHERE id = ?').get(id);
      return !!row;
    } catch {
      return false;
    }
  }

  public recordWebhookEvent(id: string, provider: string, eventType: string, userId: string | null, outcome: string): void {
    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO webhook_events (id, provider, event_type, user_id, outcome, processed_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, provider, eventType, userId, outcome, Date.now());
    } catch (err) {
      this.warnWriteFailure(`recordWebhookEvent(${id})`, err);
    }
  }

  public getWebhookEvent(id: string): { id: string; provider: string; eventType: string; userId: string | null; outcome: string; processedAt: number } | null {
    try {
      const row = this.db.prepare('SELECT id, provider, event_type AS eventType, user_id AS userId, outcome, processed_at AS processedAt FROM webhook_events WHERE id = ?').get(id) as any;
      if (!row) return null;
      return {
        id: row.id,
        provider: row.provider,
        eventType: row.eventType,
        userId: row.userId ?? null,
        outcome: row.outcome,
        processedAt: Number(row.processedAt),
      };
    } catch {
      return null;
    }
  }

  // Entitlement Management
  public saveEntitlement(ent: Entitlement): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO entitlements (id, user_id, provider, exchange, symbol_pattern, data_types, valid_until, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      ent.id,
      ent.userId,
      ent.provider,
      ent.exchange ?? null,
      ent.symbolPattern ?? null,
      JSON.stringify(ent.dataTypes),
      ent.validUntil,
      ent.createdAt
    );
  }

  public deleteEntitlement(id: string): void {
    const stmt = this.db.prepare(`DELETE FROM entitlements WHERE id = ?`);
    stmt.run(id);
  }

  public deleteUserEntitlements(userId: string): void {
    const stmt = this.db.prepare(`DELETE FROM entitlements WHERE user_id = ?`);
    stmt.run(userId);
  }

  public getEntitlementsForUser(userId: string): Entitlement[] {
    const now = Date.now();
    const stmt = this.db.prepare(`
      SELECT id, user_id, provider, exchange, symbol_pattern, data_types, valid_until, created_at
      FROM entitlements
      WHERE user_id = ? AND valid_until > ?
    `);
    const rows = stmt.all(userId, now) as any[];
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      provider: r.provider,
      exchange: r.exchange ?? undefined,
      symbolPattern: r.symbol_pattern ?? undefined,
      dataTypes: JSON.parse(r.data_types),
      validUntil: Number(r.valid_until),
      createdAt: Number(r.created_at),
    }));
  }

  // Token Revocation Management
  public revokeTokenJti(jti: string, userId: string, expiresAt: number): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO revoked_tokens (jti, user_id, expires_at, revoked_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(jti, userId, expiresAt, Date.now());
  }

  public isTokenJtiRevoked(jti: string): boolean {
    const stmt = this.db.prepare(`SELECT 1 FROM revoked_tokens WHERE jti = ?`);
    return !!stmt.get(jti);
  }

  public purgeExpiredRevocations(): void {
    const nowSec = Math.floor(Date.now() / 1000);
    this.db.exec(`DELETE FROM revoked_tokens WHERE expires_at < ${nowSec}`);
  }

  /** Force a WAL checkpoint so the -wal file does not grow without bound on a long-running node. */
  public checkpointWal(): void {
    try {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch (err) {
      console.warn(`[MarketDataStore] wal checkpoint failed: ${(err as Error).message}`);
    }
  }

  /** Reclaim space left behind by retention deletes. Expensive: run on a schedule, not per request. */
  public vacuum(): void {
    try {
      this.db.exec('VACUUM');
    } catch (err) {
      console.warn(`[MarketDataStore] vacuum failed: ${(err as Error).message}`);
    }
  }

  /** Row counts used by /metrics and the ops runbook. */
  public stats(): {
    trades: number;
    bars: number;
    gaps: number;
    users: number;
    entitlements: number;
    subscriptions: number;
    revokedTokens: number;
    depthOverflows: number;
  } {
    const count = (table: string): number => {
      try {
        const row = this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as any;
        return Number(row?.n ?? 0);
      } catch {
        return 0;
      }
    };
    return {
      trades: count('trades'),
      bars: count('bars'),
      gaps: count('gaps'),
      users: count('users'),
      entitlements: count('entitlements'),
      subscriptions: count('subscriptions'),
      revokedTokens: count('revoked_tokens'),
      depthOverflows: this.depthQueueOverflows,
    };
  }

  public listUsers(limit = 200): User[] {
    try {
      const rows = this.db
        .prepare(`SELECT id, username, role, status FROM users ORDER BY created_at DESC LIMIT ?`)
        .all(Math.min(Math.max(limit, 1), 1000)) as any[];
      return rows.map((r) => ({ id: r.id, username: r.username, role: r.role, status: r.status }));
    } catch {
      return [];
    }
  }

  /**
   * Retention cleanup.
   *
   * Ticks are the bulk of the database (~85 MB/day/instrument), so they get the short window. Bars are
   * a few hundred bytes per candle and are what the chart replays: keeping them far longer costs almost
   * nothing and gives deep history for free after the first vendor pull.
   *
   * A retention value of 0 (or less) disables deletion for that table.
   */
  public purgeOldData(olderThanMs: number, barsOlderThanMs: number = olderThanMs): void {
    const now = Date.now();
    const statements: string[] = [];

    if (olderThanMs > 0) {
      const cutoff = now - olderThanMs;
      statements.push(`DELETE FROM trades WHERE ts < ${cutoff};`);
      statements.push(`DELETE FROM gaps WHERE to_ts < ${cutoff};`);
      statements.push(`DELETE FROM depth_snapshots WHERE exchange_ts < ${cutoff};`);
    }

    if (barsOlderThanMs > 0) {
      statements.push(`DELETE FROM bars WHERE time < ${now - barsOlderThanMs};`);
    }

    if (statements.length === 0) return;
    this.db.exec(statements.join('\n'));
  }

  /**
   * Non-blocking retention cleanup: the same deletes as purgeOldData, but chunked and yielded
   * so a single synchronous SQLite statement can never freeze the event loop (on large DBs a
   * full-table DELETE blocks for minutes, killing the live feed).
   */
  public async purgeOldDataNonBlocking(olderThanMs: number, barsOlderThanMs: number = olderThanMs): Promise<void> {
    if (this.dbPath === ':memory:') {
      this.purgeOldData(olderThanMs, barsOlderThanMs);
      return;
    }
    const now = Date.now();
    const chunkSize = 20000;
    const tables: Array<{ table: string; where: string }> = [];
    if (olderThanMs > 0) {
      const cutoff = now - olderThanMs;
      tables.push({ table: 'trades', where: `ts < ${cutoff}` });
      tables.push({ table: 'gaps', where: `to_ts < ${cutoff}` });
      tables.push({ table: 'depth_snapshots', where: `exchange_ts < ${cutoff}` });
    }
    if (barsOlderThanMs > 0) {
      tables.push({ table: 'bars', where: `time < ${now - barsOlderThanMs}` });
    }
    if (tables.length === 0) return;

    for (const { table, where } of tables) {
      for (;;) {
        await new Promise((r) => setImmediate(r)); // yield: keep serving ticks between chunks
        try {
          const res = this.db
            .prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE ${where} LIMIT ${chunkSize})`)
            .run();
          if ((res.changes ?? 0) < chunkSize) break;
        } catch (err) {
          console.warn(`[MarketDataStore] chunked delete on ${table} failed: ${(err as Error).message}`);
          break;
        }
      }
    }
  }

  /**
   * Run VACUUM in a detached child process: it can take minutes on a large store and would
   * otherwise block the event loop (DatabaseSync is synchronous). The child opens its own
   * connection; when the server is writing continuously the VACUUM fails with SQLITE_BUSY
   * and is simply skipped until a quieter pass.
   */
  public vacuumInBackground(): void {
    if (this.dbPath === ':memory:') return;
    const script =
      "const {DatabaseSync}=require('node:sqlite');" +
      `const db=new DatabaseSync(${JSON.stringify(this.dbPath)});` +
      "db.exec('PRAGMA busy_timeout=30000');db.exec('VACUUM');db.close();";
    try {
      const child = spawn(process.execPath, ['-e', script], { stdio: 'ignore', detached: true });
      child.unref();
      child.on('exit', (code) => {
        if (code !== 0) console.warn(`[MarketDataStore] background VACUUM exited with code ${code} (skipped if busy)`);
      });
    } catch (err) {
      console.warn(`[MarketDataStore] background VACUUM failed to start: ${(err as Error).message}`);
    }
  }

  // Metered vendor spend.

  /** Add an estimated vendor charge to the month ledger. Never throws: accounting must not break data flow. */
  public addVendorUsage(provider: string, month: string, usd: number, requests = 1): void {
    const safeUsd = Number.isFinite(usd) && usd > 0 ? usd : 0;
    const safeRequests = Number.isFinite(requests) && requests > 0 ? Math.floor(requests) : 1;
    try {
      this.db
        .prepare(
          `INSERT INTO vendor_usage (provider, month, usd, requests, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(provider, month) DO UPDATE SET
             usd = usd + excluded.usd,
             requests = requests + excluded.requests,
             updated_at = excluded.updated_at`
        )
        .run(provider, month, safeUsd, safeRequests, Date.now());
    } catch (err) {
      console.warn(`[MarketDataStore] vendor usage write failed: ${(err as Error).message}`);
    }
  }

  public getVendorUsage(provider: string, month: string): { usd: number; requests: number; updatedAt: number } {
    try {
      const row = this.db
        .prepare(`SELECT usd, requests, updated_at FROM vendor_usage WHERE provider = ? AND month = ?`)
        .get(provider, month) as any;
      return {
        usd: Number(row?.usd ?? 0),
        requests: Number(row?.requests ?? 0),
        updatedAt: Number(row?.updated_at ?? 0),
      };
    } catch {
      return { usd: 0, requests: 0, updatedAt: 0 };
    }
  }

  public listVendorUsage(provider: string, limit = 12): Array<{ month: string; usd: number; requests: number }> {
    try {
      const rows = this.db
        .prepare(`SELECT month, usd, requests FROM vendor_usage WHERE provider = ? ORDER BY month DESC LIMIT ?`)
        .all(provider, Math.min(Math.max(limit, 1), 60)) as any[];
      return rows.map((r) => ({ month: r.month, usd: Number(r.usd), requests: Number(r.requests) }));
    } catch {
      return [];
    }
  }

  /** Ops/test helper: reset the ledger (optionally for one provider) without touching market data. */
  public clearVendorUsage(provider?: string): void {
    try {
      if (provider) {
        this.db.prepare(`DELETE FROM vendor_usage WHERE provider = ?`).run(provider);
      } else {
        this.db.exec('DELETE FROM vendor_usage');
      }
    } catch (err) {
      console.warn(`[MarketDataStore] vendor usage reset failed: ${(err as Error).message}`);
    }
  }

  // ---- Vendor instrument specs (schema=definition) ----------------------------------------------
  // Authoritative tick/point values per root, pulled from the vendor so the catalog can cover every
  // product of a dataset instead of a hand-typed list.

  /** Replace the spec set for one provider. Returns how many rows were written. */
  public upsertInstrumentSpecs(provider: string, specs: InstrumentSpecRow[]): number {
    if (specs.length === 0) return 0;
    let written = 0;
    try {
      const stmt = this.db.prepare(`
        INSERT INTO instrument_specs (
          provider, root, raw_symbol, exchange, currency, instrument_class,
          point_value, tick_size, tick_value, unit_of_measure, unit_of_measure_qty,
          underlying, activation, expiration, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(provider, root) DO UPDATE SET
          raw_symbol = excluded.raw_symbol,
          exchange = excluded.exchange,
          currency = excluded.currency,
          instrument_class = excluded.instrument_class,
          point_value = excluded.point_value,
          tick_size = excluded.tick_size,
          tick_value = excluded.tick_value,
          unit_of_measure = excluded.unit_of_measure,
          unit_of_measure_qty = excluded.unit_of_measure_qty,
          underlying = excluded.underlying,
          activation = excluded.activation,
          expiration = excluded.expiration,
          updated_at = excluded.updated_at
      `);
      const now = Date.now();
      this.db.exec('BEGIN');
      try {
        for (const spec of specs) {
          stmt.run(
            provider,
            spec.root,
            spec.rawSymbol,
            spec.exchange,
            spec.currency,
            spec.instrumentClass,
            spec.pointValue,
            spec.tickSize,
            spec.tickValue,
            spec.unitOfMeasure ?? null,
            spec.unitOfMeasureQty ?? null,
            spec.underlying ?? null,
            spec.activation ?? null,
            spec.expiration ?? null,
            now
          );
          written += 1;
        }
        this.db.exec('COMMIT');
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
    } catch (err) {
      console.warn(`[MarketDataStore] instrument spec write failed: ${(err as Error).message}`);
      return 0;
    }
    return written;
  }

  public listInstrumentSpecs(provider: string): InstrumentSpecRow[] {
    try {
      const rows = this.db
        .prepare(`SELECT * FROM instrument_specs WHERE provider = ? ORDER BY root`)
        .all(provider) as any[];
      return rows.map((r) => ({
        root: r.root,
        rawSymbol: r.raw_symbol,
        exchange: r.exchange,
        currency: r.currency,
        instrumentClass: r.instrument_class,
        pointValue: Number(r.point_value),
        tickSize: Number(r.tick_size),
        tickValue: Number(r.tick_value),
        unitOfMeasure: r.unit_of_measure ?? undefined,
        unitOfMeasureQty: r.unit_of_measure_qty === null ? undefined : Number(r.unit_of_measure_qty),
        underlying: r.underlying ?? undefined,
        activation: r.activation ?? undefined,
        expiration: r.expiration ?? undefined,
        updatedAt: Number(r.updated_at),
      }));
    } catch {
      return [];
    }
  }

  public getInstrumentSpec(provider: string, root: string): InstrumentSpecRow | null {
    try {
      const row = this.db
        .prepare(`SELECT * FROM instrument_specs WHERE provider = ? AND (root = ? OR raw_symbol = ?) LIMIT 1`)
        .get(provider, root.toUpperCase(), root.toUpperCase()) as any;
      if (!row) return null;
      return {
        root: row.root,
        rawSymbol: row.raw_symbol,
        exchange: row.exchange,
        currency: row.currency,
        instrumentClass: row.instrument_class,
        pointValue: Number(row.point_value),
        tickSize: Number(row.tick_size),
        tickValue: Number(row.tick_value),
        unitOfMeasure: row.unit_of_measure ?? undefined,
        unitOfMeasureQty: row.unit_of_measure_qty === null ? undefined : Number(row.unit_of_measure_qty),
        underlying: row.underlying ?? undefined,
        activation: row.activation ?? undefined,
        expiration: row.expiration ?? undefined,
        updatedAt: Number(row.updated_at),
      };
    } catch {
      return null;
    }
  }

  public saveRawManifest(manifest: {
    dataset: string;
    schema: string;
    symbols: string;
    date: string;
    filePath: string;
    format: string;
    bytes: number;
    checksum: string;
  }): void {
    try {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO raw_manifest (dataset, schema, symbols, date, file_path, format, bytes, checksum, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          manifest.dataset,
          manifest.schema,
          manifest.symbols,
          manifest.date,
          manifest.filePath,
          manifest.format,
          manifest.bytes,
          manifest.checksum,
          Date.now()
        );
    } catch (err) {
      this.warnWriteFailure('saveRawManifest', err);
    }
  }

  public getRawManifestFiles(dataset: string, schema: string, date: string): string[] {
    try {
      const rows = this.db
        .prepare('SELECT file_path FROM raw_manifest WHERE dataset = ? AND schema = ? AND date = ?')
        .all(dataset, schema, date) as any[] ?? [];
      return rows.map((r) => r.file_path);
    } catch {
      return [];
    }
  }

  public clearInstrumentSpecs(provider?: string): void {
    try {
      if (provider) this.db.prepare(`DELETE FROM instrument_specs WHERE provider = ?`).run(provider);
      else this.db.exec('DELETE FROM instrument_specs');
    } catch (err) {
      console.warn(`[MarketDataStore] instrument spec reset failed: ${(err as Error).message}`);
    }
  }

  public purgeInvalidInstrumentSpecs(): void {
    try {
      this.db.prepare('DELETE FROM instrument_specs WHERE tick_size > 1000 OR tick_value > 1000000 OR point_value > 10000000').run();
    } catch (err) {
      console.warn(`[MarketDataStore] purge invalid specs failed: ${(err as Error).message}`);
    }
  }

  // ---- Exposure snapshots ---------------------------------------------------
  public saveExposureSnapshot(s: { underlying: string; spot: number; timestamp: number; totals: any; walls: any; levels: any; gammaFlip: number | null; regime: string; dataSource: string }): void {
    try {
      this.db.prepare(`INSERT OR REPLACE INTO exposure_snapshots (underlying, asOf, spot, totals, walls, levels, gammaFlip, regime, dataSource) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        s.underlying.toUpperCase(), s.timestamp, s.spot, JSON.stringify(s.totals), JSON.stringify(s.walls), JSON.stringify(s.levels), s.gammaFlip, s.regime, s.dataSource
      );
    } catch (err) { console.warn(`[MarketDataStore] saveExposureSnapshot failed: ${(err as Error).message}`); }
  }
  public getLatestExposure(underlying: string): any | null {
    try {
      const row = this.db.prepare(`SELECT * FROM exposure_snapshots WHERE underlying = ? ORDER BY asOf DESC LIMIT 1`).get(underlying.toUpperCase()) as any;
      if (!row) return null;
      return { underlying: row.underlying, spot: row.spot, timestamp: row.asOf, totals: JSON.parse(row.totals), walls: JSON.parse(row.walls), levels: JSON.parse(row.levels), gammaFlip: row.gammaFlip, regime: row.regime, dataSource: row.dataSource };
    } catch { return null; }
  }

  // ---- Market Depth MBP-10 Storage -----------------------------------------
  public enqueueDepthSnapshot(snapshot: DepthSnapshotInput): void {
    if (!snapshot || !snapshot.symbol || !Number.isFinite(snapshot.exchangeTs)) return;
    const symbol = snapshot.symbol.toUpperCase().trim();
    const lastSample = this.lastDepthSampleBySymbol.get(symbol) || 0;
    if (snapshot.exchangeTs - lastSample < this.depthSamplingIntervalMs) {
      return; // Bounded sampling rate per symbol
    }
    this.lastDepthSampleBySymbol.set(symbol, snapshot.exchangeTs);

    if (this.depthWriteQueue.length >= this.maxDepthQueueSize) {
      this.depthWriteQueue.shift(); // Evict oldest to keep memory bounded
      this.depthQueueOverflows++;
      this.warnWriteFailure('enqueueDepthSnapshot queue overflow (oldest evicted)', new Error('Queue capacity reached'));
    }

    this.depthWriteQueue.push({
      ...snapshot,
      symbol,
      receiveTs: snapshot.receiveTs ?? Date.now(),
      schemaVersion: snapshot.schemaVersion ?? 1,
      dataSource: snapshot.dataSource ?? 'live',
    });

    if (this.depthWriteQueue.length >= 50) {
      this.flushDepthQueue();
    }
  }

  public flushDepthQueue(): void {
    if (this.depthWriteQueue.length === 0) return;
    const batch = this.depthWriteQueue;
    this.depthWriteQueue = [];

    try {
      this.db.exec('BEGIN IMMEDIATE');
      for (const s of batch) {
        const blob = encodeDepthLevels(s.bids, s.asks);
        this.insertDepthStmt.run(
          s.symbol,
          s.exchangeTs,
          s.receiveTs ?? Date.now(),
          s.sequenceNumber ?? null,
          s.schemaVersion ?? 1,
          s.dataSource ?? 'live',
          s.sessionId ?? null,
          blob
        );
      }
      this.db.exec('COMMIT');
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch {}
      this.warnWriteFailure(`flushDepthQueue(${batch.length} snapshots)`, err);
    }
  }

  public saveDepthSnapshot(snapshot: DepthSnapshotInput): void {
    try {
      const blob = encodeDepthLevels(snapshot.bids, snapshot.asks);
      this.insertDepthStmt.run(
        snapshot.symbol.toUpperCase().trim(),
        snapshot.exchangeTs,
        snapshot.receiveTs ?? Date.now(),
        snapshot.sequenceNumber ?? null,
        snapshot.schemaVersion ?? 1,
        snapshot.dataSource ?? 'live',
        snapshot.sessionId ?? null,
        blob
      );
    } catch (err) {
      this.warnWriteFailure(`saveDepthSnapshot(${snapshot.symbol} @ ${snapshot.exchangeTs})`, err);
    }
  }

  public saveDepthSnapshotsBatch(snapshots: DepthSnapshotInput[]): void {
    if (snapshots.length === 0) return;
    try {
      this.db.exec('BEGIN IMMEDIATE');
      for (const s of snapshots) {
        const blob = encodeDepthLevels(s.bids, s.asks);
        this.insertDepthStmt.run(
          s.symbol.toUpperCase().trim(),
          s.exchangeTs,
          s.receiveTs ?? Date.now(),
          s.sequenceNumber ?? null,
          s.schemaVersion ?? 1,
          s.dataSource ?? 'live',
          s.sessionId ?? null,
          blob
        );
      }
      this.db.exec('COMMIT');
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch {}
      this.warnWriteFailure(`saveDepthSnapshotsBatch(${snapshots.length})`, err);
    }
  }

  public queryDepthSnapshots(options: DepthQueryOptions): DepthQueryResult {
    const symbol = options.symbol.toUpperCase().trim();
    const startTime = options.startTime;
    const endTime = options.endTime;
    const limit = Math.min(Math.max(options.limit ?? 500, 1), 2000);
    const offset = Math.max(options.offset ?? 0, 0);

    const countRow = this.db.prepare(`
      SELECT COUNT(*) as total FROM depth_snapshots
      WHERE symbol = ? AND exchange_ts >= ? AND exchange_ts <= ?
    `).get(symbol, startTime, endTime) as any;
    const totalAvailable = countRow ? Number(countRow.total) : 0;

    const rows = this.db.prepare(`
      SELECT id, symbol, exchange_ts, receive_ts, sequence_number, schema_version, data_source, levels_blob
      FROM depth_snapshots
      WHERE symbol = ? AND exchange_ts >= ? AND exchange_ts <= ?
      ORDER BY exchange_ts ASC
      LIMIT ? OFFSET ?
    `).all(symbol, startTime, endTime, limit + 1, offset) as any[];

    const hasMore = rows.length > limit;
    const targetRows = hasMore ? rows.slice(0, limit) : rows;

    const resolutionMs = options.resolutionMs && options.resolutionMs > 0 ? options.resolutionMs : 0;
    const snapshots: Array<{ time: number; bids: Array<{ price: number; size: number }>; asks: Array<{ price: number; size: number }> }> = [];
    let lastBucket = -1;

    for (const r of targetRows) {
      const ts = Number(r.exchange_ts);
      if (resolutionMs > 0) {
        const bucket = Math.floor(ts / resolutionMs);
        if (bucket === lastBucket) continue;
        lastBucket = bucket;
      }
      const decoded = decodeDepthLevels(r.levels_blob);
      snapshots.push({
        time: ts,
        bids: decoded.bids,
        asks: decoded.asks,
      });
    }

    return {
      symbol,
      count: snapshots.length,
      totalAvailable,
      hasMore,
      samplingIntervalMs: options.resolutionMs || this.depthSamplingIntervalMs,
      dataSource: totalAvailable > 0 ? 'sqlite_mbp10' : 'none',
      available: snapshots.length > 0,
      snapshots,
    };
  }

  public getDepthStorageStats(symbol?: string): { count: number; oldestExchangeTs: number | null; newestExchangeTs: number | null; estimatedSizeBytes: number } {
    try {
      const sql = symbol
        ? `SELECT COUNT(*) as count, MIN(exchange_ts) as oldest, MAX(exchange_ts) as newest, SUM(LENGTH(levels_blob)) as bytes FROM depth_snapshots WHERE symbol = ?`
        : `SELECT COUNT(*) as count, MIN(exchange_ts) as oldest, MAX(exchange_ts) as newest, SUM(LENGTH(levels_blob)) as bytes FROM depth_snapshots`;
      const row = (symbol ? this.db.prepare(sql).get(symbol.toUpperCase().trim()) : this.db.prepare(sql).get()) as any;
      if (!row) return { count: 0, oldestExchangeTs: null, newestExchangeTs: null, estimatedSizeBytes: 0 };
      return {
        count: Number(row.count || 0),
        oldestExchangeTs: row.oldest ? Number(row.oldest) : null,
        newestExchangeTs: row.newest ? Number(row.newest) : null,
        estimatedSizeBytes: Number(row.bytes || 0),
      };
    } catch {
      return { count: 0, oldestExchangeTs: null, newestExchangeTs: null, estimatedSizeBytes: 0 };
    }
  }

  public cleanupOldDepthSnapshots(cutoffExchangeTs: number): number {
    try {
      const stmt = this.db.prepare('DELETE FROM depth_snapshots WHERE exchange_ts < ?');
      const info = stmt.run(cutoffExchangeTs);
      return Number(info.changes);
    } catch (err) {
      this.warnWriteFailure(`cleanupOldDepthSnapshots(${cutoffExchangeTs})`, err);
      return 0;
    }
  }

  // ---- Order Flow Alert Rules & History ------------------------------------
  public saveAlertRule(rule: AlertRule): void {
    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO alert_rules (
          id, user_id, symbol, type, threshold, timeframe, cooldown_sec, enabled, created_at, last_triggered_at, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        rule.id,
        rule.userId,
        rule.symbol.toUpperCase().trim(),
        rule.type,
        rule.threshold,
        rule.timeframe || '1m',
        rule.cooldownSec || 60,
        rule.enabled ? 1 : 0,
        rule.createdAt || Date.now(),
        rule.lastTriggeredAt ?? null,
        rule.metadata ? JSON.stringify(rule.metadata) : null
      );
    } catch (err) {
      this.warnWriteFailure(`saveAlertRule(${rule.id})`, err);
    }
  }

  public getAlertRulesForUser(userId: string): AlertRule[] {
    return this.getAlertRules(userId);
  }

  public createAlertRule(rule: Partial<AlertRule> & { userId: string; symbol: string; type: AlertRule['type']; threshold: number }): AlertRule {
    const fullRule: AlertRule = {
      id: rule.id || `rule_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      userId: rule.userId,
      symbol: rule.symbol.toUpperCase().trim(),
      type: rule.type,
      threshold: rule.threshold,
      timeframe: rule.timeframe || '1m',
      cooldownSec: rule.cooldownSec ?? 60,
      enabled: rule.enabled ?? true,
      createdAt: rule.createdAt || Date.now(),
      lastTriggeredAt: null,
      metadata: rule.metadata,
    };
    this.saveAlertRule(fullRule);
    return fullRule;
  }

  public getAlertRules(userId: string): AlertRule[] {
    try {
      const rows = this.db.prepare(`
        SELECT id, user_id, symbol, type, threshold, timeframe, cooldown_sec, enabled, created_at, last_triggered_at, metadata
        FROM alert_rules
        WHERE user_id = ?
        ORDER BY created_at DESC
      `).all(userId) as any[];

      return rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        symbol: r.symbol,
        type: r.type,
        threshold: Number(r.threshold),
        timeframe: r.timeframe,
        cooldownSec: Number(r.cooldown_sec),
        enabled: Boolean(r.enabled),
        createdAt: Number(r.created_at),
        lastTriggeredAt: r.last_triggered_at ? Number(r.last_triggered_at) : null,
        metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
      }));
    } catch (err) {
      this.warnWriteFailure(`getAlertRules(${userId})`, err);
      return [];
    }
  }

  public getActiveAlertRulesForSymbol(symbol: string): AlertRule[] {
    try {
      const rows = this.db.prepare(`
        SELECT id, user_id, symbol, type, threshold, timeframe, cooldown_sec, enabled, created_at, last_triggered_at, metadata
        FROM alert_rules
        WHERE symbol = ? AND enabled = 1
      `).all(symbol.toUpperCase().trim()) as any[];

      return rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        symbol: r.symbol,
        type: r.type,
        threshold: Number(r.threshold),
        timeframe: r.timeframe,
        cooldownSec: Number(r.cooldown_sec),
        enabled: Boolean(r.enabled),
        createdAt: Number(r.created_at),
        lastTriggeredAt: r.last_triggered_at ? Number(r.last_triggered_at) : null,
        metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
      }));
    } catch {
      return [];
    }
  }

  public getAlertRuleById(id: string, userId?: string): AlertRule | null {
    try {
      const sql = userId
        ? `SELECT * FROM alert_rules WHERE id = ? AND user_id = ?`
        : `SELECT * FROM alert_rules WHERE id = ?`;
      const row = (userId ? this.db.prepare(sql).get(id, userId) : this.db.prepare(sql).get(id)) as any;
      if (!row) return null;
      return {
        id: row.id,
        userId: row.user_id,
        symbol: row.symbol,
        type: row.type,
        threshold: Number(row.threshold),
        timeframe: row.timeframe,
        cooldownSec: Number(row.cooldown_sec),
        enabled: Boolean(row.enabled),
        createdAt: Number(row.created_at),
        lastTriggeredAt: row.last_triggered_at ? Number(row.last_triggered_at) : null,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      };
    } catch {
      return null;
    }
  }

  public updateAlertRule(rule: Partial<AlertRule> & { id: string; userId: string }): boolean {
    try {
      const existing = this.getAlertRuleById(rule.id, rule.userId);
      if (!existing) return false;
      const updated: AlertRule = {
        ...existing,
        ...rule,
        symbol: rule.symbol ? rule.symbol.toUpperCase().trim() : existing.symbol,
      };
      this.saveAlertRule(updated);
      return true;
    } catch {
      return false;
    }
  }

  public updateAlertRuleLastTriggered(id: string, triggeredAt: number): void {
    try {
      this.db.prepare(`UPDATE alert_rules SET last_triggered_at = ? WHERE id = ?`).run(triggeredAt, id);
    } catch (err) {
      this.warnWriteFailure(`updateAlertRuleLastTriggered(${id})`, err);
    }
  }

  public deleteAlertRule(id: string, userId: string): boolean {
    try {
      const res = this.db.prepare(`DELETE FROM alert_rules WHERE id = ? AND user_id = ?`).run(id, userId);
      return (res.changes ?? 0) > 0;
    } catch (err) {
      this.warnWriteFailure(`deleteAlertRule(${id})`, err);
      return false;
    }
  }

  public saveAlertHistory(item: AlertHistoryItem): void {
    try {
      this.db.prepare(`
        INSERT INTO alert_history (
          id, rule_id, user_id, symbol, type, severity, message, price, trigger_time, acknowledged, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        item.id,
        item.ruleId,
        item.userId,
        item.symbol.toUpperCase().trim(),
        item.type,
        item.severity || 'INFO',
        item.message,
        item.price ?? null,
        item.triggerTime,
        item.acknowledged ? 1 : 0,
        item.metadata ? JSON.stringify(item.metadata) : null
      );
    } catch (err) {
      this.warnWriteFailure(`saveAlertHistory(${item.id})`, err);
    }
  }

  public getAlertHistory(userId: string, limit = 50, offset = 0): { items: AlertHistoryItem[]; total: number } {
    try {
      const boundedLimit = Math.min(Math.max(limit, 1), 200);
      const countRow = this.db.prepare(`SELECT COUNT(*) as total FROM alert_history WHERE user_id = ?`).get(userId) as any;
      const total = countRow ? Number(countRow.total) : 0;

      const rows = this.db.prepare(`
        SELECT id, rule_id, user_id, symbol, type, severity, message, price, trigger_time, acknowledged, metadata
        FROM alert_history
        WHERE user_id = ?
        ORDER BY trigger_time DESC
        LIMIT ? OFFSET ?
      `).all(userId, boundedLimit, Math.max(0, offset)) as any[];

      const items: AlertHistoryItem[] = rows.map((r) => ({
        id: r.id,
        ruleId: r.rule_id,
        userId: r.user_id,
        symbol: r.symbol,
        type: r.type,
        severity: r.severity,
        message: r.message,
        price: r.price !== null && r.price !== undefined ? Number(r.price) : undefined,
        triggerTime: Number(r.trigger_time),
        acknowledged: Boolean(r.acknowledged),
        metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
      }));

      return { items, total };
    } catch (err) {
      this.warnWriteFailure(`getAlertHistory(${userId})`, err);
      return { items: [], total: 0 };
    }
  }

  public acknowledgeAlertHistory(id: string, userId: string): boolean {
    try {
      const res = this.db.prepare(`UPDATE alert_history SET acknowledged = 1 WHERE id = ? AND user_id = ?`).run(id, userId);
      return (res.changes ?? 0) > 0;
    } catch {
      return false;
    }
  }

  public clearAlertHistory(userId: string): void {
    try {
      this.db.prepare(`DELETE FROM alert_history WHERE user_id = ?`).run(userId);
    } catch (err) {
      this.warnWriteFailure(`clearAlertHistory(${userId})`, err);
    }
  }

  /**
   * Close the database connection.
   */
  public close(): void {
    if (this.depthFlushTimer) {
      clearInterval(this.depthFlushTimer);
      this.depthFlushTimer = null;
    }
    this.flushDepthQueue();
    this.db.close();
  }
}

export const marketDataStore = new MarketDataStore();

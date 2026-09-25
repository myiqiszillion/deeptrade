import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { FootprintBar, HistoricalBar, Tick } from '../types.js';
import { MarketTrade } from '../marketData/types.js';
import { Entitlement, User } from '../auth/types.js';

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

export interface GapRecord {
  id: number;
  symbol: string;
  provider: string;
  fromTs: number;
  toTs: number;
  reason: string;
  createdAt: number;
}

export class MarketDataStore {
  private db: DatabaseSync;
  private insertTradeStmt: any;
  private insertBarStmt: any;
  private insertGapStmt: any;

  constructor(dbPath?: string) {
    let resolvedPath = dbPath;
    if (!resolvedPath) {
      if (process.env.STORAGE_PATH) {
        resolvedPath = resolve(process.env.STORAGE_PATH);
      } else if (process.env.NODE_ENV === 'test' || process.env.DEV_HOOKS === '1') {
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
    this.initSchema();
  }

  private initSchema(): void {
    // Enable Write-Ahead Logging (WAL) for high concurrency and performance
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA temp_store = MEMORY;

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

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
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
    `);

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
  }

  /**
   * Batch insert trades into the persistent store. Deduplication is enforced by PRIMARY KEY (provider, symbol, trade_id).
   */
  public saveTrades(trades: (MarketTrade | Tick)[], symbol: string, provider: string): void {
    if (trades.length === 0) return;

    for (const t of trades) {
      const ts = 'ts' in t ? t.ts : t.timestamp;
      const tradeId = 'id' in t && t.id ? t.id : `t_${ts}_${t.price}_${t.size}`;
      const receiveTs = t.receiveTs ?? Date.now();
      const seqId = t.sequenceId !== undefined ? String(t.sequenceId) : null;
      const srcProvider = t.sourceProvider || provider;
      const isCoalesced = t.qualityFlags?.isCoalesced ? 1 : 0;

      this.insertTradeStmt.run(
        provider,
        symbol,
        tradeId,
        ts,
        t.price,
        t.size,
        t.side,
        t.aggressorProvenance || 'UNKNOWN',
        receiveTs,
        seqId,
        srcProvider,
        isCoalesced
      );
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
  }

  /**
   * Batch insert historical bars.
   */
  public saveBars(
    bars: HistoricalBar[],
    symbol: string,
    timeframe: string,
    provider: string
  ): void {
    for (const b of bars) {
      this.saveBar(b, symbol, timeframe, provider);
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
      side: (r.side as 'buy' | 'sell' | 'unknown'),
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
    this.insertGapStmt.run(symbol, provider, fromTs, toTs, reason, Date.now());
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
  public saveUser(user: User): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO users (id, username, role, status, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(user.id, user.username, user.role, user.status, Date.now());
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

  /**
   * Retention cleanup: delete trades and bars older than retention period.
   */
  public purgeOldData(olderThanMs: number): void {
    const cutoff = Date.now() - olderThanMs;
    this.db.exec(`
      DELETE FROM trades WHERE ts < ${cutoff};
      DELETE FROM bars WHERE time < ${cutoff};
      DELETE FROM gaps WHERE to_ts < ${cutoff};
    `);
  }

  /**
   * Close the database connection.
   */
  public close(): void {
    this.db.close();
  }
}

export const marketDataStore = new MarketDataStore();

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

export class MarketDataStore {
  private db: DatabaseSync;
  private insertTradeStmt: any;
  private insertBarStmt: any;
  private insertGapStmt: any;
  private writeFailures = 0;
  private lastWriteWarningTs = 0;

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
    this.initSchema();
  }

  private initSchema(): void {
    // Enable Write-Ahead Logging (WAL) for high concurrency and performance
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
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

      -- Metered vendor spend ledger (Databento bills historical pulls per GB on top of the monthly
      -- subscription). One row per provider+month so a restart cannot silently forget the total.
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
    } catch (err) {
      // A transient SQLite error (e.g. SQLITE_BUSY while another writer holds the lock) must never
      // escape into the feed's trade handler: an uncaught throw there kills the whole server.
      this.warnWriteFailure(`saveTrades(${provider}/${symbol}, ${trades.length} trades)`, err);
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
    }

    if (barsOlderThanMs > 0) {
      statements.push(`DELETE FROM bars WHERE time < ${now - barsOlderThanMs};`);
    }

    if (statements.length === 0) return;
    this.db.exec(statements.join('\n'));
  }

  // Metered vendor spend (Databento historical pulls are billed per GB on top of the subscription).

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

  public clearInstrumentSpecs(provider?: string): void {
    try {
      if (provider) this.db.prepare(`DELETE FROM instrument_specs WHERE provider = ?`).run(provider);
      else this.db.exec('DELETE FROM instrument_specs');
    } catch (err) {
      console.warn(`[MarketDataStore] instrument spec reset failed: ${(err as Error).message}`);
    }
  }

  /**
   * Close the database connection.
   */
  public close(): void {
    this.db.close();
  }
}

export const marketDataStore = new MarketDataStore();

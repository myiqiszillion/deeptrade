import assert from 'node:assert/strict';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MarketDataStore } from '../../src/storage/marketDataStore.js';
import { sampleHistoricalBars } from '../fixtures/bars.js';
import { sampleTicks } from '../fixtures/trades.js';

const TEST_DB = resolve(process.cwd(), 'test_market_data_store.sqlite');

export async function runMarketDataStoreTests(): Promise<void> {
  console.log('[unit/marketDataStore.test] Running MarketDataStore unit tests...');

  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);

  try {
    const store = new MarketDataStore(TEST_DB);

    // 1. Trade Persistence & Deduplication
    store.saveTrades(sampleTicks, 'ES', 'databento');
    // Save again to verify deduplication
    store.saveTrades(sampleTicks, 'ES', 'databento');

    const tradesResult = store.queryTrades({ provider: 'databento', symbol: 'ES', limit: 10 });
    assert.equal(tradesResult.trades.length, 3, 'Must have exactly 3 deduplicated trades');
    assert.equal(tradesResult.trades[0].id, 't_1');
    assert.equal(tradesResult.trades[1].id, 't_2');
    assert.equal(tradesResult.trades[2].id, 't_3');

    // 2. Composite Cursor Pagination
    const page1 = store.queryTrades({ provider: 'databento', symbol: 'ES', limit: 2 });
    assert.equal(page1.trades.length, 2, 'Page 1 must return 2 trades');
    assert.equal(page1.hasMore, true, 'Page 1 must have more trades');
    assert.ok(page1.cursor, 'Page 1 must return cursor');

    const page2 = store.queryTrades({
      provider: 'databento',
      symbol: 'ES',
      beforeTime: page1.cursor!.beforeTime,
      beforeId: page1.cursor!.beforeId,
      limit: 2,
    });
    assert.equal(page2.trades.length, 1, 'Page 2 must return the remaining 1 trade');
    assert.equal(page2.trades[0].id, 't_1');

    // 3. Provider Scoping (no cross-provider leakage)
    const otherProviderTrades = store.queryTrades({ provider: 'fixture', symbol: 'ES', limit: 10 });
    assert.equal(otherProviderTrades.trades.length, 0, 'Querying different provider must return 0 trades');

    // 4. Bar Persistence & Pagination
    store.saveBars(sampleHistoricalBars, 'ES', '1m', 'databento');
    const barsResult = store.queryBars({ provider: 'databento', symbol: 'ES', timeframe: '1m', limit: 2 });
    assert.equal(barsResult.bars.length, 2, 'Must return 2 most recent bars');
    assert.equal(barsResult.hasMore, true);
    assert.ok(barsResult.cursor);

    const earlierBars = store.queryBars({
      provider: 'databento',
      symbol: 'ES',
      timeframe: '1m',
      beforeTime: barsResult.cursor!.beforeTime,
      limit: 2,
    });
    assert.equal(earlierBars.bars.length, 2);
    assert.equal(earlierBars.hasMore, false);

    // 5. Gap Recording
    store.recordGap('ES', 'databento', 1700000000000, 1700000010000, 'network_disconnect');
    const gaps = store.getGaps('ES');
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].reason, 'network_disconnect');

    // 6. User & Entitlement & Revocation Persistence
    store.saveUser({ id: 'u_p1', username: 'persistent1', role: 'user', status: 'active' });
    const user = store.getUser('u_p1');
    assert.ok(user);
    assert.equal(user.username, 'persistent1');

    store.saveEntitlement({
      id: 'ent_p1',
      userId: 'u_p1',
      provider: 'cme',
      symbolPattern: 'ES',
      dataTypes: ['FOOTPRINT'],
      validUntil: Date.now() + 100000,
      createdAt: Date.now(),
    });
    const ents = store.getEntitlementsForUser('u_p1');
    assert.equal(ents.length, 1);
    assert.equal(ents[0].symbolPattern, 'ES');

    store.revokeTokenJti('jti_p1', 'u_p1', Math.floor(Date.now() / 1000) + 3600);
    assert.equal(store.isTokenJtiRevoked('jti_p1'), true);

    // Close and Reopen Store
    store.close();

    const reopenedStore = new MarketDataStore(TEST_DB);
    assert.equal(reopenedStore.queryTrades({ provider: 'databento', symbol: 'ES', limit: 10 }).trades.length, 3);
    assert.equal(reopenedStore.queryBars({ provider: 'databento', symbol: 'ES', timeframe: '1m', limit: 10 }).bars.length, 4);
    assert.equal(reopenedStore.getUser('u_p1')?.username, 'persistent1');
    assert.equal(reopenedStore.isTokenJtiRevoked('jti_p1'), true);
    reopenedStore.close();

    // 7. TASK 1: SQLite Migration Safety & Legacy Database Compatibility
    const LEGACY_DB = resolve(process.cwd(), 'test_legacy_migration.sqlite');
    if (existsSync(LEGACY_DB)) unlinkSync(LEGACY_DB);
    try {
      // Create legacy database with single-column PRIMARY KEY (instrument_id)
      const legacyRaw = new DatabaseSync(LEGACY_DB);
      legacyRaw.exec(`
        CREATE TABLE instrument_master (
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
        CREATE INDEX idx_master_dataset ON instrument_master(dataset, asset);
        CREATE UNIQUE INDEX idx_master_raw ON instrument_master(dataset, raw_symbol);

        INSERT INTO instrument_master (
          instrument_id, dataset, publisher_id, raw_symbol, security_type, asset,
          exchange, tick_size, updated_at
        ) VALUES (10252, 'GLBX.MDP3', 1, 'ESM4', 'F', 'ES', 'CME', 0.25, 1711033200000);
      `);
      legacyRaw.close();

      // Verify old schema has pk=1 on instrument_id and pk=0 on dataset
      const preCheck = new DatabaseSync(LEGACY_DB);
      const preCols = preCheck.prepare('PRAGMA table_info(instrument_master)').all() as Array<{ name: string; pk: number }>;
      assert.equal(preCols.find(c => c.name === 'instrument_id')?.pk, 1);
      assert.equal(preCols.find(c => c.name === 'dataset')?.pk, 0);
      preCheck.close();

      // Now start MarketDataStore on the legacy DB - should trigger automatic safe migration
      const migratedStore = new MarketDataStore(LEGACY_DB);

      // Verify columns after migration: both dataset and instrument_id must have pk > 0
      const postCols = (migratedStore as any).db.prepare('PRAGMA table_info(instrument_master)').all() as Array<{ name: string; pk: number }>;
      const dsPk = postCols.find((c: any) => c.name === 'dataset')?.pk;
      const idPk = postCols.find((c: any) => c.name === 'instrument_id')?.pk;
      assert.ok((dsPk ?? 0) > 0, `dataset must be part of composite primary key (got pk=${dsPk})`);
      assert.ok((idPk ?? 0) > 0, `instrument_id must be part of composite primary key (got pk=${idPk})`);

      // Verify existing rows preserved
      const existingRow = (migratedStore as any).db.prepare('SELECT * FROM instrument_master WHERE dataset = ? AND instrument_id = ?').get('GLBX.MDP3', 10252) as any;
      assert.ok(existingRow, 'Legacy instrument row must be preserved');
      assert.equal(existingRow.raw_symbol, 'ESM4');

      // Verify schema_migrations table updated
      const migrationEntry = (migratedStore as any).db.prepare("SELECT * FROM schema_migrations WHERE name = 'instrument_master_composite_pk'").get();
      assert.ok(migrationEntry, 'Migration record must be written');

      // Verify idempotency: restart on migrated DB
      migratedStore.close();
      const idempotentStore = new MarketDataStore(LEGACY_DB);
      const idempCols = (idempotentStore as any).db.prepare('PRAGMA table_info(instrument_master)').all() as Array<{ name: string; pk: number }>;
      assert.ok((idempCols.find((c: any) => c.name === 'dataset')?.pk ?? 0) > 0);
      assert.ok((idempCols.find((c: any) => c.name === 'instrument_id')?.pk ?? 0) > 0);

      // 8. TASK 2: Multi-Dataset Instrument ID Uniqueness & Multi-Dataset Isolation
      // Same instrument_id (10252) can now coexist across different datasets without collision
      (idempotentStore as any).db.prepare(`
        INSERT INTO instrument_master (
          instrument_id, dataset, publisher_id, raw_symbol, security_type, asset,
          exchange, tick_size, updated_at
        ) VALUES (10252, 'OPRA.PILLAR', 2, 'SPY240621C00500000', 'O', 'SPY', 'OPRA', 0.01, 1711033200000)
      `).run();

      const cmeRow = (idempotentStore as any).db.prepare('SELECT * FROM instrument_master WHERE dataset = ? AND instrument_id = ?').get('GLBX.MDP3', 10252) as any;
      const opraRow = (idempotentStore as any).db.prepare('SELECT * FROM instrument_master WHERE dataset = ? AND instrument_id = ?').get('OPRA.PILLAR', 10252) as any;
      assert.ok(cmeRow && opraRow, 'Both datasets must hold the same instrument_id simultaneously');
      assert.equal(cmeRow.raw_symbol, 'ESM4');
      assert.equal(cmeRow.dataset, 'GLBX.MDP3');
      assert.equal(opraRow.raw_symbol, 'SPY240621C00500000');
      assert.equal(opraRow.dataset, 'OPRA.PILLAR');

      // Add rollover fixture for temporal correctness
      (idempotentStore as any).db.prepare(`
        INSERT INTO instrument_master (
          instrument_id, dataset, publisher_id, raw_symbol, security_type, asset,
          exchange, activation, expiration, tick_size, updated_at
        ) VALUES (10389, 'GLBX.MDP3', 1, 'ESU4', 'F', 'ES', 'CME', '2024-06-15T00:00:00.000Z', '2024-09-20T13:30:00.000Z', 0.25, 1711033200000)
      `).run();

      const esInstruments = (idempotentStore as any).db.prepare('SELECT * FROM instrument_master WHERE dataset = ? AND asset = ? ORDER BY expiration ASC').all('GLBX.MDP3', 'ES') as any[];
      assert.equal(esInstruments.length, 2);

      idempotentStore.close();
    } finally {
      if (existsSync(LEGACY_DB)) unlinkSync(LEGACY_DB);
    }

    // 9. Fail-Closed Migration Safety: Backup Failure Halts Migration & Preserves Legacy Schema
    const FAIL_BACKUP_DB = resolve(process.cwd(), 'test_legacy_backup_fail.sqlite');
    const BLOCKER_FILE = resolve(process.cwd(), 'test_backup_dir_blocker.tmp');
    if (existsSync(FAIL_BACKUP_DB)) unlinkSync(FAIL_BACKUP_DB);
    if (existsSync(BLOCKER_FILE)) unlinkSync(BLOCKER_FILE);

    const savedBackupDir = process.env.BACKUP_DIR;
    try {
      // Step A: Create an isolated legacy SQLite database needing migration
      const legacyRaw = new DatabaseSync(FAIL_BACKUP_DB);
      legacyRaw.exec(`
        CREATE TABLE instrument_master (
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
        CREATE INDEX idx_master_dataset ON instrument_master(dataset, asset);
        CREATE UNIQUE INDEX idx_master_raw ON instrument_master(dataset, raw_symbol);

        INSERT INTO instrument_master (
          instrument_id, dataset, publisher_id, raw_symbol, security_type, asset,
          exchange, tick_size, updated_at
        ) VALUES (99999, 'GLBX.MDP3', 1, 'ESZ4', 'F', 'ES', 'CME', 0.25, 1711033200000);
      `);
      legacyRaw.close();

      // Step B: Simulate backup failure (unwritable path by placing BACKUP_DIR under a regular file)
      writeFileSync(BLOCKER_FILE, 'not_a_directory');
      process.env.BACKUP_DIR = resolve(BLOCKER_FILE, 'forbidden_subfolder');

      // Step C: Verify that initializing MarketDataStore fails closed and throws
      assert.throws(
        () => {
          new MarketDataStore(FAIL_BACKUP_DB);
        },
        (err: any) => {
          assert.match(err.message, /Pre-migration safety backup failed/);
          return true;
        },
        'MarketDataStore must fail-closed and throw when pre-migration backup fails'
      );

      // Step D: Verify schema of FAIL_BACKUP_DB was NOT modified (Fail-Closed guarantee)
      const inspectDb = new DatabaseSync(FAIL_BACKUP_DB);
      const cols = inspectDb.prepare('PRAGMA table_info(instrument_master)').all() as Array<{ name: string; pk: number }>;
      assert.equal(cols.find((c) => c.name === 'dataset')?.pk, 0, 'dataset pk must remain 0 (unmigrated)');
      assert.equal(cols.find((c) => c.name === 'instrument_id')?.pk, 1, 'instrument_id pk must remain 1');

      const migrationTable = inspectDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
      assert.equal(migrationTable, undefined, 'schema_migrations must not exist because migration was aborted');

      const preservedRow = inspectDb.prepare('SELECT * FROM instrument_master WHERE instrument_id = ?').get(99999) as any;
      assert.ok(preservedRow, 'Legacy data must remain completely intact');
      assert.equal(preservedRow.raw_symbol, 'ESZ4');
      inspectDb.close();

      // Step E: Unblock backup directory and verify safe migration succeeds
      if (existsSync(BLOCKER_FILE)) unlinkSync(BLOCKER_FILE);
      delete process.env.BACKUP_DIR;

      const workingStore = new MarketDataStore(FAIL_BACKUP_DB);
      const postCols = (workingStore as any).db.prepare('PRAGMA table_info(instrument_master)').all() as Array<{ name: string; pk: number }>;
      assert.ok(((postCols.find((c: any) => c.name === 'dataset')?.pk) ?? 0) > 0, 'dataset must be part of composite PK after unblocking');
      assert.ok(((postCols.find((c: any) => c.name === 'instrument_id')?.pk) ?? 0) > 0, 'instrument_id must be part of composite PK');
      workingStore.close();
    } finally {
      if (savedBackupDir !== undefined) {
        process.env.BACKUP_DIR = savedBackupDir;
      } else {
        delete process.env.BACKUP_DIR;
      }
      if (existsSync(BLOCKER_FILE)) unlinkSync(BLOCKER_FILE);
      if (existsSync(FAIL_BACKUP_DB)) unlinkSync(FAIL_BACKUP_DB);
    }

    console.log('  [PASS] All MarketDataStore unit tests passed.');
  } finally {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  }
}

if (process.argv[1]?.endsWith('marketDataStore.test.ts') || process.argv[1]?.endsWith('marketDataStore.test.js')) {
  runMarketDataStoreTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';

async function run() {
  console.log('--- STAGING DATABASE VALIDATION ---');
  
  const dbDir = path.join(process.cwd(), 'staging_data');
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  const dbPath = path.join(dbDir, 'market_data.sqlite');
  
  // Cleanup previous runs
  ['market_data.sqlite', 'market_data.sqlite-wal', 'market_data.sqlite-shm', 'backup_graceful.sqlite', 'backup_active.sqlite', 'restore.sqlite'].forEach(f => {
    const p = path.join(dbDir, f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });

  console.log(`\n[Setup] Create database at ${dbPath}`);
  let db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  
  // Simulate schema (migrations)
  db.exec(`CREATE TABLE IF NOT EXISTS bars (provider TEXT, symbol TEXT, timeframe TEXT, time INTEGER, open REAL, high REAL, low REAL, close REAL, volume REAL, PRIMARY KEY (provider, symbol, timeframe, time));`);
  db.exec(`CREATE TABLE IF NOT EXISTS depth_snapshots (symbol TEXT, time INTEGER, bids TEXT, asks TEXT, PRIMARY KEY (symbol, time));`);
  db.exec(`CREATE TABLE IF NOT EXISTS alert_rules (id TEXT PRIMARY KEY, symbol TEXT, condition TEXT, target REAL);`);

  console.log(`\n[Setup] Insert sample records`);
  const now = Date.now();
  db.prepare('INSERT OR REPLACE INTO bars VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('test', 'ES', '1m', now, 4000, 4010, 3990, 4005, 100);
  db.prepare('INSERT OR REPLACE INTO depth_snapshots VALUES (?, ?, ?, ?)').run('ES', now, '[]', '[]');
  db.prepare('INSERT OR REPLACE INTO alert_rules VALUES (?, ?, ?, ?)').run('rule1', 'ES', 'price_above', 4050);

  // D. Verify counts
  const barCount = db.prepare('SELECT COUNT(*) as count FROM bars').get() as { count: number };
  console.log(`[D] Initial records inserted: bars=${barCount.count}`);

  // A. Backup sau graceful shutdown.
  console.log(`\n[A] Backup after graceful shutdown`);
  db.close();
  const backupGracefulPath = path.join(dbDir, 'backup_graceful.sqlite');
  // Safe backup after close: copy file (WAL is checkpointed on graceful close)
  fs.copyFileSync(dbPath, backupGracefulPath);
  console.log(`    Backup created: ${fs.existsSync(backupGracefulPath)}`);

  // Reopen
  db = new DatabaseSync(dbPath);

  // B. Backup khi database đang có active WAL transactions.
  console.log(`\n[B] Backup with active WAL transactions`);
  db.exec('BEGIN EXCLUSIVE TRANSACTION;');
  db.prepare('INSERT OR REPLACE INTO bars VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('test', 'NQ', '1m', now, 15000, 15010, 14990, 15005, 50);
  
  const backupActivePath = path.join(dbDir, 'backup_active.sqlite');
  try {
    // VACUUM INTO safely backs up even inside a transaction and with WAL
    // However, SQLite VACUUM INTO might block or not capture uncommitted if in transaction
    // Let's commit and then do an active WAL (no checkpoint) 
    // or just run VACUUM INTO (it creates a snapshot of the last committed state).
    db.exec('COMMIT;');
    // Write more to keep WAL active
    db.prepare('INSERT OR REPLACE INTO bars VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('test', 'YM', '1m', now, 35000, 35010, 34990, 35005, 50);
    
    // Using VACUUM INTO for consistent online backup (this is safe even with WAL and open connections)
    db.exec(`VACUUM INTO '${backupActivePath.replace(/\\/g, '/')}';`);
    console.log(`    Online backup (VACUUM INTO) created: ${fs.existsSync(backupActivePath)}`);
  } catch (e: any) {
    console.error(`    Backup failed:`, e.message);
  }

  // F. Test backup failure handling
  console.log(`\n[F] Test backup failure handling`);
  try {
    const invalidPath = path.join(dbDir, 'non_existent_dir', 'backup.sqlite');
    db.exec(`VACUUM INTO '${invalidPath.replace(/\\/g, '/')}';`);
    console.log(`    FAILED: Should have thrown error`);
  } catch (e: any) {
    console.log(`    Expected failure caught: ${e.message}`);
  }

  // C. Restore vào database mới.
  console.log(`\n[C] Restore into new database`);
  const restorePath = path.join(dbDir, 'restore.sqlite');
  fs.copyFileSync(backupActivePath, restorePath);
  const restoreDb = new DatabaseSync(restorePath);
  
  // G. Test không làm thay đổi database nguồn
  console.log(`\n[G] Verify source db unchanged`);
  restoreDb.prepare('DELETE FROM bars').run();
  const sourceCountAfterRestore = db.prepare('SELECT COUNT(*) as count FROM bars').get() as { count: number };
  console.log(`    Source db count (should be 3): ${sourceCountAfterRestore.count}`);

  // D. Verify row counts, depth snapshots, alert rules và timestamps trên bản gốc restore
  console.log(`\n[D] Verify data integrity on restored backup`);
  restoreDb.close(); // Close the one we just wiped
  fs.unlinkSync(restorePath);
  fs.copyFileSync(backupActivePath, restorePath); // Re-restore
  const verifyDb = new DatabaseSync(restorePath);
  
  // Verify integrity
  const integrity = verifyDb.prepare('PRAGMA integrity_check;').get();
  console.log(`    Integrity check: ${JSON.stringify(integrity)}`);
  
  const vBars = verifyDb.prepare('SELECT COUNT(*) as c FROM bars').get() as { c: number };
  const vDepths = verifyDb.prepare('SELECT COUNT(*) as c FROM depth_snapshots').get() as { c: number };
  const vAlerts = verifyDb.prepare('SELECT COUNT(*) as c FROM alert_rules').get() as { c: number };
  
  console.log(`    Bars: ${vBars.c} (expected 3)`);
  console.log(`    Depths: ${vDepths.c} (expected 1)`);
  console.log(`    Alerts: ${vAlerts.c} (expected 1)`);

  // E. Test migration compatibility
  console.log(`\n[E] Test migration compatibility`);
  try {
    verifyDb.exec(`ALTER TABLE bars ADD COLUMN new_col TEXT;`);
    console.log(`    Schema altered successfully on restored db.`);
  } catch (e: any) {
    console.log(`    Migration failed: ${e.message}`);
  }

  verifyDb.close();
  db.close();

  console.log('\n--- VALIDATION COMPLETE ---');
}

run().catch(console.error);

#!/usr/bin/env node
/**
 * Online SQLite backup + verification.
 *
 * `VACUUM INTO` produces a consistent snapshot while the server keeps running, which is what a
 * production deployment needs for its daily backup job:
 *
 *   node scripts/backup_db.mjs                               # ./data/market_data.sqlite -> backups/
 *   STORAGE_PATH=/app/data/market_data.sqlite BACKUP_DIR=/backups node scripts/backup_db.mjs
 *
 * Keep the whole backups/ directory on a different volume (or object storage) than the live DB.
 */
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const sourcePath = resolve(process.env.STORAGE_PATH || './data/market_data.sqlite');
const backupDir = resolve(process.env.BACKUP_DIR || dirname(sourcePath));
const keep = Math.max(1, parseInt(process.env.BACKUP_KEEP || '7', 10));

if (!existsSync(sourcePath)) {
  console.error(`[backup] source database not found: ${sourcePath}`);
  process.exit(1);
}
mkdirSync(backupDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const baseName = basename(sourcePath, '.sqlite');
const target = join(backupDir, `${baseName}-${stamp}.sqlite`);

const started = Date.now();
const db = new DatabaseSync(sourcePath, { readOnly: true });
try {
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
} finally {
  db.close();
}

// Verify the snapshot instead of trusting that the copy exists.
const check = new DatabaseSync(target, { readOnly: true });
try {
  const integrity = check.prepare('PRAGMA integrity_check').get();
  const value = integrity ? Object.values(integrity)[0] : 'unknown';
  if (value !== 'ok') {
    console.error(`[backup] integrity_check failed: ${value}`);
    process.exit(1);
  }
  const trades = check.prepare('SELECT COUNT(*) AS n FROM trades').get();
  const bars = check.prepare('SELECT COUNT(*) AS n FROM bars').get();
  console.log(
    `[backup] snapshot ${target} (${(statSync(target).size / 1048576).toFixed(1)} MB, ` +
      `${Number(trades?.n ?? 0)} trades / ${Number(bars?.n ?? 0)} bars) written in ${Date.now() - started}ms`
  );
} finally {
  check.close();
}

// Retention: keep the newest N snapshots.
const snapshots = readdirSync(backupDir)
  .filter((name) => name.startsWith(`${baseName}-`) && name.endsWith('.sqlite'))
  .map((name) => ({ name, mtime: statSync(join(backupDir, name)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);

for (const stale of snapshots.slice(keep)) {
  unlinkSync(join(backupDir, stale.name));
  console.log(`[backup] pruned old snapshot ${stale.name}`);
}

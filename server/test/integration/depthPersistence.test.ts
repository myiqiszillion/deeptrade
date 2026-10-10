import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { MarketDataStore } from '../../src/storage/marketDataStore.js';
import { DepthSnapshotInput } from '../../src/storage/types.js';

export async function runDepthPersistenceTests(): Promise<void> {
  console.log('[integration/depthPersistence.test] Running DB Depth Persistence and Restart Recovery tests...');

  const dbPath = path.join(process.cwd(), 'test_depth_recovery.sqlite');
  
  // Clean up any existing file
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  if (fs.existsSync(dbPath + '-wal')) fs.unlinkSync(dbPath + '-wal');
  if (fs.existsSync(dbPath + '-shm')) fs.unlinkSync(dbPath + '-shm');

  const baseTs = 1700000000000;
  const testSnapshots: DepthSnapshotInput[] = [];

  // Generate 5 snapshots
  for (let i = 0; i < 5; i++) {
    testSnapshots.push({
      symbol: 'NQ',
      exchangeTs: baseTs + i * 1000,
      receiveTs: baseTs + i * 1000 + 5,
      sequenceNum: 1000 + i,
      bids: [[20000.0 - i * 0.25, 10 + i]],
      asks: [[20000.25 + i * 0.25, 15 + i]],
      source: 'databento',
    } as any);
  }

  // Phase 1: Write to database
  {
    const store = new MarketDataStore(dbPath);
    store.saveDepthSnapshotsBatch(testSnapshots);
    
    // Query to verify
    const res = store.queryDepthSnapshots({
      symbol: 'NQ',
      startTime: baseTs,
      endTime: baseTs + 5000,
    });
    assert.strictEqual(res.snapshots.length, 5, 'Should have 5 snapshots before restart');
    
    // Simulate process termination
    store.close();
  }

  // Phase 2: Restart and recover
  {
    const recoveredStore = new MarketDataStore(dbPath);
    
    const res = recoveredStore.queryDepthSnapshots({
      symbol: 'NQ',
      startTime: baseTs,
      endTime: baseTs + 5000,
    });
    
    assert.strictEqual(res.snapshots.length, 5, 'Should fully recover 5 snapshots after restart');
    
    for (let i = 0; i < 5; i++) {
      assert.strictEqual(res.snapshots[i].time, baseTs + i * 1000, 'Timestamp should match exactly');
      assert.strictEqual(res.snapshots[i].bids[0].price, 20000.0 - i * 0.25, 'Decoded bid price should match exactly');
      assert.strictEqual(res.snapshots[i].bids[0].size, 10 + i, 'Decoded bid size should match exactly');
      assert.strictEqual(res.snapshots[i].asks[0].price, 20000.25 + i * 0.25, 'Decoded ask price should match exactly');
      assert.strictEqual(res.snapshots[i].asks[0].size, 15 + i, 'Decoded ask size should match exactly');
    }

    recoveredStore.close();
  }

  // Clean up test file
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  if (fs.existsSync(dbPath + '-wal')) fs.unlinkSync(dbPath + '-wal');
  if (fs.existsSync(dbPath + '-shm')) fs.unlinkSync(dbPath + '-shm');

  console.log('  [PASS] DB Depth Persistence and Restart Recovery tests passed.');
}

if (process.argv[1]?.endsWith('depthPersistence.test.ts') || process.argv[1]?.endsWith('depthPersistence.test.js')) {
  runDepthPersistenceTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

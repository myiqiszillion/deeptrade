import assert from 'node:assert';
import { encodeDepthBinary, decodeDepthBinary } from '../../src/storage/depthCodec.js';
import { MarketDataStore } from '../../src/storage/marketDataStore.js';
import { DepthSnapshotInput } from '../../src/storage/types.js';

export async function runDepthStorageTests() {
  console.log('[unit/depthStorage.test] Running MBP-10 Depth Storage & Codec unit tests...');

  // Test 1: Binary Codec Serialization & Precision
  {
    const sampleBids: [number, number][] = [
      [5700.25, 45],
      [5700.00, 120],
      [5699.75, 80],
      [5699.50, 15],
      [5699.25, 60],
      [5699.00, 110],
      [5698.75, 95],
      [5698.50, 40],
      [5698.25, 75],
      [5698.00, 200],
    ];
    const sampleAsks: [number, number][] = [
      [5700.50, 30],
      [5700.75, 85],
      [5701.00, 140],
      [5701.25, 65],
      [5701.50, 90],
      [5701.75, 115],
      [5702.00, 50],
      [5702.25, 80],
      [5702.50, 60],
      [5702.75, 250],
    ];

    const buf = encodeDepthBinary(sampleBids, sampleAsks);
    assert.strictEqual(buf.length, 322, 'Encoded buffer size must be exactly 322 bytes');

    const decoded = decodeDepthBinary(buf);
    assert.strictEqual(decoded.bids.length, 10, 'Decoded bids must have 10 levels');
    assert.strictEqual(decoded.asks.length, 10, 'Decoded asks must have 10 levels');

    for (let i = 0; i < 10; i++) {
      assert.strictEqual(decoded.bids[i][0], sampleBids[i][0], `Bid price mismatch at index ${i}`);
      assert.strictEqual(decoded.bids[i][1], sampleBids[i][1], `Bid size mismatch at index ${i}`);
      assert.strictEqual(decoded.asks[i][0], sampleAsks[i][0], `Ask price mismatch at index ${i}`);
      assert.strictEqual(decoded.asks[i][1], sampleAsks[i][1], `Ask size mismatch at index ${i}`);
    }
  }

  // Test 2: SQLite Depth Snapshot Persistence & Range Query
  {
    const store = new MarketDataStore(':memory:');
    const baseTs = 1700000000000;
    const testSnapshots: DepthSnapshotInput[] = [];

    for (let i = 0; i < 10; i++) {
      testSnapshots.push({
        symbol: 'ES',
        exchangeTs: baseTs + i * 1000,
        receiveTs: baseTs + i * 1000 + 5,
        sequenceNum: 1000 + i,
        bids: [[5700.0 - i * 0.25, 10 + i]],
        asks: [[5700.25 + i * 0.25, 15 + i]],
        source: 'databento',
      } as any);
    }

    store.saveDepthSnapshotsBatch(testSnapshots);

    // Query exact time range
    const res = store.queryDepthSnapshots({
      symbol: 'ES',
      startTime: baseTs + 2000,
      endTime: baseTs + 6000,
    });

    assert.strictEqual(res.snapshots.length, 5, 'Should return 5 snapshots between [2000, 6000]');
    assert.strictEqual(res.snapshots[0].time, baseTs + 2000, 'First snapshot should match startTime');
    assert.strictEqual(res.snapshots[4].time, baseTs + 6000, 'Last snapshot should match endTime');
    assert.strictEqual(res.snapshots[0].bids[0].price, 5699.5, 'First snapshot bid price should match');

    // Test Downsampling (resolutionMs = 2000)
    const downsampled = store.queryDepthSnapshots({
      symbol: 'ES',
      startTime: baseTs,
      endTime: baseTs + 9000,
      resolutionMs: 2000,
    });
    // Expected buckets: 0, 2000, 4000, 6000, 8000 -> 5 snapshots
    assert.strictEqual(downsampled.snapshots.length, 5, 'Downsampled query should filter to 5 snapshots');
    assert.strictEqual(downsampled.samplingIntervalMs, 2000, 'Sampling interval metadata should match');

    // Test Retention Cleanup
    const deleted = store.cleanupOldDepthSnapshots(baseTs + 5000);
    assert.strictEqual(deleted, 5, 'Retention cleanup should delete snapshots strictly before cutoff');

    const remaining = store.queryDepthSnapshots({
      symbol: 'ES',
      startTime: baseTs,
      endTime: baseTs + 10000,
    });
    assert.strictEqual(remaining.snapshots.length, 5, 'Remaining snapshots should be 5');
    assert.strictEqual(remaining.snapshots[0].time, baseTs + 5000, 'Earliest remaining snapshot should be at cutoff');

    store.close();
  }

  console.log('  [PASS] All MBP-10 Depth Storage & Codec unit tests passed.');
}

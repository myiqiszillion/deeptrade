import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { BatchIngestionQueue } from '../../src/databento/batchIngestion.js';

export async function runBatchIngestionTests(): Promise<void> {
  console.log('[unit/batchIngestion.test] Running BatchIngestionQueue unit tests...');

  // 1. Batch size flush
  {
    const flushedBatches: number[][] = [];
    const queue = new BatchIngestionQueue<number>({
      batchSize: 5,
      maxWaitMs: 1000,
      onFlush: (batch) => {
        flushedBatches.push(batch);
      },
    });

    for (let i = 1; i <= 5; i++) {
      queue.push(i);
    }

    assert.equal(flushedBatches.length, 1);
    assert.deepEqual(flushedBatches[0], [1, 2, 3, 4, 5]);
    assert.equal(queue.pendingCount, 0);

    console.log('  PASS  Batch size threshold flush');
  }

  // 2. Timer timeout flush
  {
    const flushedBatches: string[][] = [];
    const queue = new BatchIngestionQueue<string>({
      batchSize: 10,
      maxWaitMs: 30,
      onFlush: (batch) => {
        flushedBatches.push(batch);
      },
    });

    queue.push('trade_1');
    queue.push('trade_2');
    assert.equal(queue.pendingCount, 2);
    assert.equal(flushedBatches.length, 0);

    // Wait for timer to fire
    await new Promise((r) => setTimeout(r, 60));

    assert.equal(flushedBatches.length, 1);
    assert.deepEqual(flushedBatches[0], ['trade_1', 'trade_2']);
    assert.equal(queue.pendingCount, 0);

    console.log('  PASS  Max wait timeout flush');
  }

  // 3. Manual immediate flush
  {
    const flushedBatches: number[][] = [];
    const queue = new BatchIngestionQueue<number>({
      batchSize: 100,
      maxWaitMs: 5000,
      onFlush: (batch) => {
        flushedBatches.push(batch);
      },
    });

    queue.push(10);
    queue.push(20);
    await queue.flush();

    assert.equal(flushedBatches.length, 1);
    assert.deepEqual(flushedBatches[0], [10, 20]);
    assert.equal(queue.pendingCount, 0);

    console.log('  PASS  Manual immediate flush');
  }

  console.log('  [PASS] All BatchIngestionQueue unit tests passed.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runBatchIngestionTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

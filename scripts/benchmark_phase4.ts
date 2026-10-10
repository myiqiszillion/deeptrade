import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import { MarketDataStore, marketDataStore } from '../server/src/storage/marketDataStore.js';
import { DepthSnapshotInput } from '../server/src/storage/types.js';
import { encodeDepthLevels, decodeDepthLevels } from '../server/src/storage/depthCodec.js';
import { AlertEngine } from '../server/src/alerts/alertEngine.js';
import { FootprintBar, Tick } from '../server/src/types.js';

interface BenchmarkResult {
  category: string;
  metric: string;
  value: string;
  details: string;
}

async function runPhase4Benchmarks() {
  console.log('================================================================');
  console.log('⚡ DEEPCHART PHASE 4: STORAGE & ALERT ENGINE BENCHMARK');
  console.log('================================================================');

  const sysInfo = {
    platform: `${os.type()} ${os.release()} (${os.arch()})`,
    cpus: `${os.cpus()[0]?.model} (${os.cpus().length} cores)`,
    totalMemMb: Math.round(os.totalmem() / 1024 / 1024),
    nodeVersion: process.version,
  };

  console.log(`Environment: ${sysInfo.platform}`);
  console.log(`CPU:         ${sysInfo.cpus}`);
  console.log(`RAM:         ${sysInfo.totalMemMb} MB`);
  console.log(`Node:        ${sysInfo.nodeVersion}\n`);

  const results: BenchmarkResult[] = [];
  const initialMem = process.memoryUsage();

  // ---------------------------------------------------------------------------
  // 1. MBP-10 Binary Codec Benchmark
  // ---------------------------------------------------------------------------
  console.log('1. Measuring MBP-10 Binary Buffer Codec (Serialization/Deserialization)...');
  const CODEC_ITERATIONS = 50000;
  const sampleSnapshot: DepthSnapshotInput = {
    symbol: 'ES',
    exchangeTs: 1700000000000,
    receiveTs: 1700000000005,
    sequenceNumber: 12345678,
    schemaVersion: 1,
    dataSource: 'databento',
    bids: Array.from({ length: 10 }, (_, i) => ({ price: 5700.0 - i * 0.25, size: 50 + i * 5 })),
    asks: Array.from({ length: 10 }, (_, i) => ({ price: 5700.25 + i * 0.25, size: 40 + i * 4 })),
  };

  const tStartEncode = performance.now();
  let encodedSample: Buffer = Buffer.alloc(0);
  for (let i = 0; i < CODEC_ITERATIONS; i++) {
    encodedSample = encodeDepthLevels(sampleSnapshot.bids, sampleSnapshot.asks);
  }
  const tEndEncode = performance.now();
  const encodeDurationMs = tEndEncode - tStartEncode;
  const encodeRate = Math.round((CODEC_ITERATIONS / encodeDurationMs) * 1000);

  const tStartDecode = performance.now();
  for (let i = 0; i < CODEC_ITERATIONS; i++) {
    decodeDepthLevels(encodedSample);
  }
  const tEndDecode = performance.now();
  const decodeDurationMs = tEndDecode - tStartDecode;
  const decodeRate = Math.round((CODEC_ITERATIONS / decodeDurationMs) * 1000);

  results.push({
    category: 'Binary Codec',
    metric: 'Depth Encode Throughput',
    value: `${encodeRate.toLocaleString()} enc/sec`,
    details: `${encodedSample.length} bytes per MBP-10 record (${encodeDurationMs.toFixed(1)}ms for ${CODEC_ITERATIONS.toLocaleString()})`,
  });

  results.push({
    category: 'Binary Codec',
    metric: 'Depth Decode Throughput',
    value: `${decodeRate.toLocaleString()} dec/sec`,
    details: `${((decodeDurationMs / CODEC_ITERATIONS) * 1000).toFixed(2)} µs/decode`,
  });

  // ---------------------------------------------------------------------------
  // 2. SQLite Persistent Depth Storage Batch Ingestion & Query Benchmarks
  // ---------------------------------------------------------------------------
  console.log('2. Measuring SQLite WAL Depth Storage (Batch Ingest & Query Latency)...');
  const tempDbPath = path.join(os.tmpdir(), `bench_depth_${Date.now()}.db`);
  const store = new MarketDataStore(tempDbPath);

  const SNAPSHOT_COUNT = 25000;
  const BATCH_SIZE = 1000;
  const baseTs = 1700000000000;
  const generatedSnapshots: DepthSnapshotInput[] = new Array(SNAPSHOT_COUNT);

  for (let i = 0; i < SNAPSHOT_COUNT; i++) {
    const ts = baseTs + i * 100; // 100ms interval = 2,500s of market depth
    generatedSnapshots[i] = {
      symbol: 'ES',
      exchangeTs: ts,
      receiveTs: ts + 2,
      sequenceNumber: 1000000 + i,
      schemaVersion: 1,
      dataSource: 'bench_databento',
      bids: [
        { price: 5700.0, size: 50 + (i % 20) },
        { price: 5699.75, size: 80 + (i % 30) },
      ],
      asks: [
        { price: 5700.25, size: 45 + (i % 15) },
        { price: 5700.50, size: 90 + (i % 25) },
      ],
    };
  }

  // Measure Batch Insert
  const tStartInsert = performance.now();
  for (let i = 0; i < SNAPSHOT_COUNT; i += BATCH_SIZE) {
    const batch = generatedSnapshots.slice(i, i + BATCH_SIZE);
    store.saveDepthSnapshotsBatch(batch);
  }
  const tEndInsert = performance.now();
  const insertDurationMs = tEndInsert - tStartInsert;
  const depthInsertRate = Math.round((SNAPSHOT_COUNT / insertDurationMs) * 1000);

  results.push({
    category: 'Storage Ingestion',
    metric: 'MBP-10 Depth Write Throughput',
    value: `${depthInsertRate.toLocaleString()} snapshots/sec`,
    details: `${SNAPSHOT_COUNT.toLocaleString()} snapshots in ${insertDurationMs.toFixed(1)}ms (${(insertDurationMs / (SNAPSHOT_COUNT / BATCH_SIZE)).toFixed(2)}ms per 1k batch)`,
  });

  // Check file sizes
  const dbStat = fs.statSync(tempDbPath);
  const walPath = `${tempDbPath}-wal`;
  const walSize = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;
  const totalSizeBytes = dbStat.size + walSize;

  results.push({
    category: 'Storage Density',
    metric: 'Database Footprint per Snapshot',
    value: `${(totalSizeBytes / SNAPSHOT_COUNT).toFixed(1)} bytes/snapshot`,
    details: `Total DB+WAL size: ${(totalSizeBytes / 1024 / 1024).toFixed(2)} MB for ${SNAPSHOT_COUNT.toLocaleString()} records`,
  });

  // Measure Time-Range Query Latency (Raw vs Downsampled)
  const QUERY_ROUNDS = 20;
  const tStartQueryRaw = performance.now();
  for (let i = 0; i < QUERY_ROUNDS; i++) {
    store.queryDepthSnapshots({
      symbol: 'ES',
      startTime: baseTs + 50000,
      endTime: baseTs + 150000,
      limit: 1000,
    });
  }
  const queryRawDurationMs = (performance.now() - tStartQueryRaw) / QUERY_ROUNDS;

  results.push({
    category: 'Storage Query',
    metric: 'Raw Range Query Latency (1,000 snapshots)',
    value: `${queryRawDurationMs.toFixed(2)} ms`,
    details: `B-tree index scan over (symbol, exchange_ts ASC)`,
  });

  const tStartQueryDownsample = performance.now();
  for (let i = 0; i < QUERY_ROUNDS; i++) {
    store.queryDepthSnapshots({
      symbol: 'ES',
      startTime: baseTs,
      endTime: baseTs + 200000,
      resolutionMs: 2000, // 2s bucket downsampling
      limit: 500,
    });
  }
  const queryDownsampleDurationMs = (performance.now() - tStartQueryDownsample) / QUERY_ROUNDS;

  results.push({
    category: 'Storage Query',
    metric: 'Downsampled Range Query Latency (2s resolution)',
    value: `${queryDownsampleDurationMs.toFixed(2)} ms`,
    details: `Downsampling query across 200,000ms window`,
  });

  // Measure Retention Cleanup
  const tStartCleanup = performance.now();
  const deletedCount = store.cleanupOldDepthSnapshots(baseTs + 50000);
  const cleanupDurationMs = performance.now() - tStartCleanup;

  results.push({
    category: 'Storage Lifecycle',
    metric: 'Retention Purge Latency',
    value: `${cleanupDurationMs.toFixed(2)} ms`,
    details: `Purged ${deletedCount.toLocaleString()} expired depth snapshots`,
  });

  store.close();
  // Cleanup temp files
  try {
    fs.rmSync(tempDbPath, { force: true });
    fs.rmSync(walPath, { force: true });
    fs.rmSync(`${tempDbPath}-shm`, { force: true });
  } catch {}

  // ---------------------------------------------------------------------------
  // 3. Order Flow Alert Engine Evaluation Throughput
  // ---------------------------------------------------------------------------
  console.log('3. Measuring Order Flow Alert Engine Evaluation Latency & Throughput...');
  const alertEngine = new AlertEngine();
  const testUserId = 'bench_user';

  // Seed alert rules in memory
  marketDataStore.createAlertRule({
    userId: testUserId,
    symbol: 'ES',
    type: 'LARGE_TRADE',
    threshold: 100,
    cooldownSec: 5,
    enabled: true,
  });

  marketDataStore.createAlertRule({
    userId: testUserId,
    symbol: 'ES',
    type: 'STACKED_IMBALANCE',
    threshold: 3.0,
    cooldownSec: 5,
    enabled: true,
  });

  const TICK_EVAL_COUNT = 100000;
  const evalTicks: Tick[] = new Array(TICK_EVAL_COUNT);
  for (let i = 0; i < TICK_EVAL_COUNT; i++) {
    evalTicks[i] = {
      id: `tick_${i}`,
      timestamp: baseTs + i,
      price: 5700.0 + (i % 8) * 0.25,
      size: (i % 150) + 1, // periodically hits 100+
      side: i % 2 === 0 ? 'buy' : 'sell',
    };
  }

  const tStartTickEval = performance.now();
  for (let i = 0; i < TICK_EVAL_COUNT; i++) {
    alertEngine.evaluateTick('ES', evalTicks[i]);
  }
  const tickEvalDurationMs = performance.now() - tStartTickEval;
  const tickEvalRate = Math.round((TICK_EVAL_COUNT / tickEvalDurationMs) * 1000);

  results.push({
    category: 'Alert Engine',
    metric: 'Tick Alert Evaluation Rate',
    value: `${tickEvalRate.toLocaleString()} ticks/sec`,
    details: `${((tickEvalDurationMs / TICK_EVAL_COUNT) * 1000).toFixed(2)} µs per tick evaluation with active rules`,
  });

  // Measure Footprint Bar Imbalance Evaluation
  const BAR_EVAL_COUNT = 5000;
  const sampleBar: FootprintBar = {
    id: 'bar_bench',
    isClosed: true,
    time: 1700000000000,
    open: 5700.0,
    high: 5702.0,
    low: 5698.0,
    close: 5701.5,
    volume: 5000,
    buyVolume: 2800,
    sellVolume: 2200,
    delta: 600,
    minDelta: -100,
    maxDelta: 700,
    cvd: 1500,
    poc: 5700.5,
    levels: {
      5700.0: { price: 5700.0, bidVol: 10, askVol: 50, totalVol: 60, delta: 40, bidImbalance: false, askImbalance: true },
      5700.25: { price: 5700.25, bidVol: 5, askVol: 60, totalVol: 65, delta: 55, bidImbalance: false, askImbalance: true },
      5700.50: { price: 5700.50, bidVol: 5, askVol: 80, totalVol: 85, delta: 75, bidImbalance: false, askImbalance: true },
      5700.75: { price: 5700.75, bidVol: 5, askVol: 100, totalVol: 105, delta: 95, bidImbalance: false, askImbalance: true },
    },
    unfinishedHigh: false,
    unfinishedLow: false,
  };

  const tStartBarEval = performance.now();
  for (let i = 0; i < BAR_EVAL_COUNT; i++) {
    alertEngine.evaluateFootprintBar('ES', sampleBar, 0.25);
  }
  const barEvalDurationMs = performance.now() - tStartBarEval;
  const barEvalRate = Math.round((BAR_EVAL_COUNT / barEvalDurationMs) * 1000);

  results.push({
    category: 'Alert Engine',
    metric: 'Footprint Bar Imbalance Evaluation',
    value: `${barEvalRate.toLocaleString()} bars/sec`,
    details: `${((barEvalDurationMs / BAR_EVAL_COUNT) * 1000).toFixed(2)} µs per multi-level ladder analysis`,
  });

  // Memory Impact
  const finalMem = process.memoryUsage();
  const heapGrowthMb = (finalMem.heapUsed - initialMem.heapUsed) / 1024 / 1024;

  results.push({
    category: 'System Resource',
    metric: 'Net Heap Growth during Benchmark',
    value: `${heapGrowthMb >= 0 ? '+' : ''}${heapGrowthMb.toFixed(2)} MB`,
    details: `RSS: ${(finalMem.rss / 1024 / 1024).toFixed(1)} MB, Heap: ${(finalMem.heapUsed / 1024 / 1024).toFixed(1)} MB`,
  });

  // ---------------------------------------------------------------------------
  // Summary Table
  // ---------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('📊 BENCHMARK RESULTS TABLE');
  console.log('================================================================');
  console.table(
    results.map((r) => ({
      Category: r.category,
      Metric: r.metric,
      Throughput_Latency: r.value,
      Details: r.details,
    }))
  );
}

runPhase4Benchmarks().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});

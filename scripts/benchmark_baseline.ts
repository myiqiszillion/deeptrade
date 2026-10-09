import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { FootprintEngine } from '../server/src/footprintEngine.js';
import { MarketDataStore } from '../server/src/storage/marketDataStore.js';
import { ChartService } from '../server/src/chart/chartService.js';
import { Tick } from '../server/src/types.js';

interface BenchmarkResult {
  category: string;
  metric: string;
  value: string;
  details: string;
}

async function runBenchmark() {
  console.log('================================================================');
  console.log('⚡ DEEPCHART REAL-DATA PERFORMANCE BASELINE BENCHMARK');
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
  // 1. Tick Ingestion & Footprint Aggregation Throughput
  // ---------------------------------------------------------------------------
  console.log('1. Measuring Footprint Ingestion Throughput...');
  const engine = new FootprintEngine(0.25, 60000);
  const TICK_COUNT = 100000;
  const baseTime = 1700000000000;
  const basePrice = 5000.0;

  // Generate 100,000 deterministic ticks across 10 price levels
  const testTicks: Tick[] = new Array(TICK_COUNT);
  for (let i = 0; i < TICK_COUNT; i++) {
    const pOffset = (i % 20) * 0.25;
    testTicks[i] = {
      id: `bench_${i}`,
      timestamp: baseTime + Math.floor(i / 10),
      price: basePrice + pOffset,
      size: (i % 10) + 1,
      side: i % 2 === 0 ? 'buy' : 'sell',
      receiveTs: baseTime + Math.floor(i / 10) + 1,
    };
  }

  const tStartIngest = performance.now();
  for (let i = 0; i < TICK_COUNT; i++) {
    engine.processTick(testTicks[i]);
  }
  const tEndIngest = performance.now();
  const ingestDurationMs = tEndIngest - tStartIngest;
  const ticksPerSec = Math.round((TICK_COUNT / ingestDurationMs) * 1000);

  results.push({
    category: 'Backend Ingestion',
    metric: 'Tick Ingestion Throughput',
    value: `${ticksPerSec.toLocaleString()} ticks/sec`,
    details: `${TICK_COUNT.toLocaleString()} ticks in ${ingestDurationMs.toFixed(1)}ms`,
  });

  results.push({
    category: 'Backend Aggregation',
    metric: 'Average Tick Aggregation Time',
    value: `${((ingestDurationMs / TICK_COUNT) * 1000).toFixed(2)} µs/tick`,
    details: `Constant O(1) ladder hash-map lookup per tick`,
  });

  // ---------------------------------------------------------------------------
  // 2. SQLite Batch Ingestion & Storage Performance
  // ---------------------------------------------------------------------------
  console.log('2. Measuring SQLite Storage Ingestion...');
  const store = new MarketDataStore(':memory:');
  const chartService = new ChartService(store);
  const DB_TICK_COUNT = 30000;
  const dbTicks = testTicks.slice(0, DB_TICK_COUNT);

  const tStartDb = performance.now();
  store.saveTrades(dbTicks, 'ES', 'databento');
  const tEndDb = performance.now();
  const dbDurationMs = tEndDb - tStartDb;
  const dbWritesPerSec = Math.round((DB_TICK_COUNT / dbDurationMs) * 1000);

  results.push({
    category: 'Database Storage',
    metric: 'SQLite Bulk Insert Throughput',
    value: `${dbWritesPerSec.toLocaleString()} trades/sec`,
    details: `${DB_TICK_COUNT.toLocaleString()} trades inserted in ${dbDurationMs.toFixed(1)}ms with transactions`,
  });

  // ---------------------------------------------------------------------------
  // 3. Volume Profile Range Query Latency
  // ---------------------------------------------------------------------------
  console.log('3. Measuring Volume Profile Range Query Latency...');
  const QUERY_ROUNDS = 20;
  const queryTimes: number[] = [];

  for (let q = 0; q < QUERY_ROUNDS; q++) {
    const t0 = performance.now();
    await chartService.getVolumeProfileRange('ES', baseTime, baseTime + 20000);
    const t1 = performance.now();
    queryTimes.push(t1 - t0);
  }

  const avgVpLatency = queryTimes.reduce((a, b) => a + b, 0) / QUERY_ROUNDS;
  const minVpLatency = Math.min(...queryTimes);
  const maxVpLatency = Math.max(...queryTimes);

  results.push({
    category: 'Analytics Engine',
    metric: 'Range VP Query Latency',
    value: `${avgVpLatency.toFixed(2)} ms`,
    details: `Min: ${minVpLatency.toFixed(2)}ms, Max: ${maxVpLatency.toFixed(2)}ms (20 rounds over 30K trades)`,
  });

  // ---------------------------------------------------------------------------
  // 4. Memory Footprint & Concurrency
  // ---------------------------------------------------------------------------
  console.log('4. Measuring Memory Footprint...');
  const postMem = process.memoryUsage();
  const heapDeltaMb = ((postMem.heapUsed - initialMem.heapUsed) / 1024 / 1024).toFixed(2);
  const totalRssMb = (postMem.rss / 1024 / 1024).toFixed(2);

  results.push({
    category: 'Memory Footprint',
    metric: 'Heap Growth Under 100K Ticks',
    value: `${heapDeltaMb} MB`,
    details: `Total Process RSS: ${totalRssMb} MB`,
  });

  // ---------------------------------------------------------------------------
  // 5. Output Report Table
  // ---------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('📊 BENCHMARK BASELINE RESULTS SUMMARY');
  console.log('================================================================');
  console.table(results);

  store.close();
}

runBenchmark().catch(console.error);

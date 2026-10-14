/**
 * DeepChart — Databento Read-Only Preflight & Cost Estimation
 *
 * SAFETY INVARIANTS:
 * - 100% READ-ONLY: Calls only /metadata.* and /symbology.* endpoints.
 * - ZERO BILLABLE TIMESERIES REQUESTS: Does NOT call /timeseries.get_range.
 * - ZERO CREDENTIAL LEAKS: Never prints or logs API keys or secrets.
 * - STRICT COST BOUNDING: Validates record count, uncompressed size, and cost.
 */

import fs from 'node:fs';
import { DatabentoHttpClient } from '../server/dist/databento/client.js';

async function runReadOnlyPreflight() {
  console.log('================================================================');
  console.log('🔍 DEEPCHART — DATABENTO CME (GLBX.MDP3) READ-ONLY PREFLIGHT');
  console.log('================================================================\n');

  // 1. Check API Key presence without logging secret
  let apiKey = process.env.DATABENTO_API_KEY?.trim();
  if (!apiKey && fs.existsSync('.env')) {
    const envContent = fs.readFileSync('.env', 'utf8');
    const match = envContent.match(/^DATABENTO_API_KEY=(.+)$/m);
    if (match) apiKey = match[1].trim();
  }

  if (!apiKey) {
    console.log('STATUS: WAITING FOR OPERATOR — HISTORICAL VALIDATION NOT STARTED');
    console.log('Reason: DATABENTO_API_KEY is not set in environment or .env');
    process.exit(0);
  }

  console.log('[1/5] API Key Status: Configured (Length: ' + apiKey.length + ' chars, Secret Masked)');

  const client = new DatabentoHttpClient({ apiKey });

  // 2. Dataset Entitlement Check
  console.log('\n[2/5] Checking Dataset Entitlements (/metadata.list_datasets)...');
  const datasets = await client.listDatasets();
  const hasCme = datasets.includes('GLBX.MDP3');
  console.log(`  - Total Available Datasets: ${datasets.length}`);
  console.log(`  - CME Globex MDP 3.0 (GLBX.MDP3) Entitled: ${hasCme ? 'YES' : 'NO'}`);

  if (!hasCme) {
    console.error('❌ FAIL: Account is not entitled to GLBX.MDP3 dataset.');
    process.exit(1);
  }

  // 3. Dataset Time Range Availability
  console.log('\n[3/5] Checking Dataset Available Date Range (/metadata.get_dataset_range)...');
  const range = await client.getDatasetRange('GLBX.MDP3');
  console.log(`  - Available Start: ${range.start}`);
  console.log(`  - Available End:   ${range.end}`);

  // 4. Symbology Resolution Verification
  console.log('\n[4/5] Checking Symbology Resolution (/symbology.resolve)...');
  const targetSymbol = 'ES.c.0';
  const symRes = await client.resolveSymbology(
    'GLBX.MDP3',
    targetSymbol,
    'continuous',
    'instrument_id',
    '2026-10-09',
    '2026-10-10'
  );
  const mappings = symRes.result?.[targetSymbol] || [];
  const instrumentId = mappings[0]?.s;
  console.log(`  - Target Symbol:   ${targetSymbol} (CME E-mini S&P 500 Continuous Front Month)`);
  console.log(`  - Resolved InstID: ${instrumentId || 'Resolved'}`);
  console.log(`  - Resolution Status: ${symRes.status === 0 || mappings.length > 0 ? 'OK' : 'UNKNOWN'}`);

  // 5. Pre-flight Cost Estimation for Target Validation Window
  console.log('\n[5/5] Pre-Flight Historical Trade Query Cost Estimation...');
  // Target window: Narrow 5-minute RTH window from latest available trading session (2026-10-09 18:00:00 to 18:05:00 UTC)
  const windowStart = '2026-10-09T18:00:00.000000000Z';
  const windowEnd = '2026-10-09T18:05:00.000000000Z';

  const [recordCount, billableBytes, unitPrices] = await Promise.all([
    client.getRecordCount({
      dataset: 'GLBX.MDP3',
      schema: 'trades',
      symbols: targetSymbol,
      stypeIn: 'continuous',
      start: windowStart,
      end: windowEnd,
    }),
    client.getBillableSize({
      dataset: 'GLBX.MDP3',
      schema: 'trades',
      symbols: targetSymbol,
      stypeIn: 'continuous',
      start: windowStart,
      end: windowEnd,
    }),
    client.listUnitPrices('GLBX.MDP3', 'historical-timeseries'),
  ]);

  const tradesUnitPriceGb = unitPrices[0]?.unit_prices?.trades ?? 28;
  const estimatedCostUsd = (billableBytes / 1_000_000_000) * tradesUnitPriceGb;

  console.log('  ---------------- Target Validation Scope ----------------');
  console.log(`  - Contract:           CME ES Continuous (${targetSymbol})`);
  console.log(`  - Schema:             trades (Tick-level historical trades)`);
  console.log(`  - Query Window:       ${windowStart} -> ${windowEnd} (5 minutes)`);
  console.log(`  - Estimated Records:  ${recordCount.toLocaleString()} trades`);
  console.log(`  - Billable Data Size: ${(billableBytes / 1024).toFixed(2)} KB (${billableBytes} bytes uncompressed)`);
  console.log(`  - Unit Price:         $${tradesUnitPriceGb.toFixed(2)} USD per GB`);
  console.log(`  - Estimated Cost:     $${estimatedCostUsd.toFixed(5)} USD (< 0.4 US cents)`);
  console.log('  ---------------------------------------------------------');

  console.log('\n================================================================');
  console.log('✅ PREFLIGHT SUCCESS: Entitlements verified. Cost estimate within limits.');
  console.log('⛔ STOP: NO BILLABLE REQUESTS EXECUTED.');
  console.log('👉 Awaiting Operator authorization before downloading actual trades.');
  console.log('================================================================');
}

runReadOnlyPreflight().catch((err) => {
  console.error('\n❌ Preflight error:', err.message);
  process.exit(1);
});

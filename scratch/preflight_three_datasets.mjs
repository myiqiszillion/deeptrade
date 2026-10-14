/**
 * DeepChart — Three-Dataset Databento Read-Only Preflight
 *
 * SAFETY INVARIANTS:
 * - 100% READ-ONLY: Calls only /metadata.* and /symbology.* endpoints.
 * - ZERO BILLABLE TIMESERIES REQUESTS: Does NOT call /timeseries.get_range.
 * - ZERO CREDENTIAL LEAKS: Never prints or logs API keys or secrets.
 */

import fs from 'node:fs';
import { DatabentoHttpClient } from '../server/dist/databento/client.js';

const DATASETS = [
  { id: 'GLBX.MDP3', name: 'CME Globex MDP 3.0', symbols: ['ES.c.0'], stypeIn: 'continuous', testSchema: 'trades' },
  { id: 'OPRA.PILLAR', name: 'OPRA Options', symbols: ['SPY'], stypeIn: 'raw_symbol', testSchema: 'trades' },
  { id: 'EQUS.MINI', name: 'US Equities Mini', symbols: ['SPY'], stypeIn: 'raw_symbol', testSchema: 'trades' },
];

const results = [];

async function runPreflight() {
  console.log('================================================================');
  console.log('🔍 DEEPCHART — THREE-DATASET DATABENTO READ-ONLY PREFLIGHT');
  console.log('================================================================\n');

  // 1. API Key
  let apiKey = process.env.DATABENTO_API_KEY?.trim();
  if (!apiKey && fs.existsSync('.env')) {
    const envContent = fs.readFileSync('.env', 'utf8');
    const match = envContent.match(/^DATABENTO_API_KEY=(.+)$/m);
    if (match) apiKey = match[1].trim();
  }
  if (!apiKey) {
    console.log('❌ DATABENTO_API_KEY not set. Aborting.');
    process.exit(1);
  }
  console.log(`[API KEY] Configured (${apiKey.length} chars, masked)\n`);

  const client = new DatabentoHttpClient({ apiKey });

  // 2. List all datasets
  console.log('[DATASETS] Querying /metadata.list_datasets...');
  let allDatasets;
  try {
    allDatasets = await client.listDatasets();
    console.log(`  Total datasets accessible: ${allDatasets.length}`);
    for (const ds of DATASETS) {
      const found = allDatasets.includes(ds.id);
      console.log(`  ${ds.id} (${ds.name}): ${found ? '✅ FOUND' : '❌ NOT FOUND'}`);
      if (!found) {
        results.push({ dataset: ds.id, metadata: 'NOT_FOUND', schemas: [], range: null, symbology: 'N/A', costEstimate: null, blocker: 'Dataset not in entitlement list' });
      }
    }
  } catch (err) {
    console.error('  ❌ Failed to list datasets:', err.message);
    process.exit(1);
  }

  // 3. Per-dataset checks
  for (const ds of DATASETS) {
    console.log(`\n${'='.repeat(64)}`);
    console.log(`📊 ${ds.id} — ${ds.name}`);
    console.log('='.repeat(64));

    const entry = { dataset: ds.id, name: ds.name, metadata: 'UNKNOWN', schemas: [], range: null, symbology: 'UNKNOWN', costEstimate: null, blocker: null };

    if (!allDatasets.includes(ds.id)) {
      entry.metadata = 'NOT_FOUND';
      entry.blocker = 'Dataset not in metadata list';
      results.push(entry);
      continue;
    }
    entry.metadata = 'METADATA_ACCESS_VERIFIED';

    // 3a. Schemas
    console.log(`\n  [SCHEMAS] /metadata.list_schemas?dataset=${ds.id}`);
    try {
      const schemas = await client.listSchemas(ds.id);
      entry.schemas = schemas;
      console.log(`  Available schemas (${schemas.length}): ${schemas.join(', ')}`);
    } catch (err) {
      console.log(`  ❌ Schema list failed: ${err.message}`);
      entry.blocker = `Schema listing error: ${err.message}`;
    }

    // 3b. Date Range
    console.log(`\n  [RANGE] /metadata.get_dataset_range?dataset=${ds.id}`);
    try {
      const range = await client.getDatasetRange(ds.id);
      entry.range = range;
      console.log(`  Start: ${range.start}`);
      console.log(`  End:   ${range.end}`);
    } catch (err) {
      console.log(`  ❌ Range query failed: ${err.message}`);
    }

    // 3c. Symbology Resolution
    console.log(`\n  [SYMBOLOGY] /symbology.resolve for ${ds.symbols.join(', ')}`);
    try {
      const today = new Date();
      const startDate = new Date(today.getTime() - 3 * 86400000).toISOString().slice(0, 10);
      const endDate = today.toISOString().slice(0, 10);
      const symRes = await client.resolveSymbology(
        ds.id, ds.symbols, ds.stypeIn, 'instrument_id', startDate, endDate
      );
      const mappings = symRes.result || {};
      const notFound = symRes.not_found || [];
      const symbolKey = ds.symbols[0];
      const resolved = mappings[symbolKey] || [];
      const instId = resolved[0]?.s || resolved[0]?.instrument_id || '(none)';
      entry.symbology = resolved.length > 0 ? 'RESOLVED' : 'NOT_RESOLVED';
      console.log(`  Symbol "${symbolKey}" → instrument_id: ${instId}`);
      console.log(`  Resolution: ${entry.symbology}`);
      if (notFound.length > 0) console.log(`  Not found: ${notFound.join(', ')}`);
    } catch (err) {
      console.log(`  ❌ Symbology failed: ${err.message}`);
      entry.symbology = `ERROR: ${err.message.slice(0, 100)}`;
    }

    // 3d. Unit Prices (cost info, non-billable)
    console.log(`\n  [UNIT PRICES] /metadata.list_unit_prices?dataset=${ds.id}`);
    try {
      const unitPrices = await client.listUnitPrices(ds.id, 'historical-timeseries');
      if (Array.isArray(unitPrices) && unitPrices.length > 0) {
        // Databento returns nested structure
        const first = unitPrices[0];
        if (first?.unit_prices) {
          const keys = Object.keys(first.unit_prices);
          console.log(`  Mode: historical-timeseries`);
          for (const k of keys.slice(0, 8)) {
            console.log(`    ${k}: $${first.unit_prices[k]}/GB`);
          }
        } else {
          console.log(`  Raw: ${JSON.stringify(unitPrices).slice(0, 300)}`);
        }
      } else {
        console.log(`  No unit price data returned.`);
      }
    } catch (err) {
      console.log(`  ⚠️ Unit prices query failed (may be expected): ${err.message.slice(0, 150)}`);
    }

    // 3e. Cost estimation for a small trade query (5 min window)
    if (entry.schemas.includes(ds.testSchema) && entry.range) {
      console.log(`\n  [COST ESTIMATE] 5-min ${ds.testSchema} query`);
      try {
        const endDate = entry.range.end;
        // Pick a date 2 days before the end of data
        const endTs = new Date(endDate).getTime();
        const safeEnd = new Date(endTs - 2 * 86400000);
        const safeStart = new Date(safeEnd.getTime() - 5 * 60000);
        const windowStart = safeStart.toISOString();
        const windowEnd = safeEnd.toISOString();

        const [recordCount, billableBytes] = await Promise.all([
          client.getRecordCount({
            dataset: ds.id,
            schema: ds.testSchema,
            symbols: ds.symbols[0],
            stypeIn: ds.stypeIn,
            start: windowStart,
            end: windowEnd,
          }),
          client.getBillableSize({
            dataset: ds.id,
            schema: ds.testSchema,
            symbols: ds.symbols[0],
            stypeIn: ds.stypeIn,
            start: windowStart,
            end: windowEnd,
          }),
        ]);

        entry.costEstimate = { recordCount, billableBytes, windowStart, windowEnd };
        console.log(`  Window: ${windowStart} → ${windowEnd}`);
        console.log(`  Records: ${recordCount.toLocaleString()}`);
        console.log(`  Billable bytes: ${billableBytes.toLocaleString()} (${(billableBytes / 1024).toFixed(2)} KB)`);
      } catch (err) {
        console.log(`  ⚠️ Cost estimate failed: ${err.message.slice(0, 200)}`);
        // This could indicate historical access is blocked
        if (err.message.includes('401') || err.message.includes('403')) {
          entry.blocker = `HISTORICAL ACCESS BLOCKED: ${err.message.slice(0, 100)}`;
        }
      }
    }

    // 3f. Dataset condition (recent dates)
    console.log(`\n  [CONDITION] Last 3 days data condition`);
    try {
      const endDate = new Date().toISOString().slice(0, 10);
      const startDate = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
      const condition = await client.getDatasetCondition(ds.id, startDate, endDate);
      if (Array.isArray(condition) && condition.length > 0) {
        for (const c of condition.slice(-5)) {
          console.log(`    ${c.date}: ${c.condition}${c.details ? ` (${c.details})` : ''}`);
        }
      } else {
        console.log(`    No condition data returned.`);
      }
    } catch (err) {
      console.log(`    ⚠️ Condition query failed: ${err.message.slice(0, 100)}`);
    }

    results.push(entry);
  }

  // 4. Summary
  console.log(`\n${'='.repeat(64)}`);
  console.log('📋 PREFLIGHT SUMMARY');
  console.log('='.repeat(64));
  console.log('');
  console.log('Dataset          | Metadata             | Schemas | Symbology    | Blocker');
  console.log('-----------------|----------------------|---------|--------------|--------');
  for (const r of results) {
    const schemas = r.schemas?.length || 0;
    const blocker = r.blocker || 'NONE';
    console.log(`${r.dataset.padEnd(17)}| ${(r.metadata || '').padEnd(21)}| ${String(schemas).padEnd(8)}| ${(r.symbology || '').padEnd(13)}| ${blocker}`);
  }

  console.log('\n================================================================');
  console.log('✅ PREFLIGHT COMPLETE — All queries read-only, zero billable.');
  console.log('⛔ NO timeseries.get_range calls were made.');
  console.log('================================================================');
}

runPreflight().catch((err) => {
  console.error('\n❌ Preflight error:', err.message);
  console.error(err.stack);
  process.exit(1);
});

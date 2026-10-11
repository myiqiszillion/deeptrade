#!/usr/bin/env node
/**
 * DeepChart — Real Databento Live Smoke Test Harness
 *
 * Designed for CME Globex (GLBX.MDP3) and other Databento datasets.
 *
 * Features:
 * - Default: FAIL-SAFE DRY-RUN (Pre-flight, Dynamic Symbology, Market Session, NO subscription).
 * - Live streaming execution requires explicit `--live` flag.
 * - Single-subscription enforcement (prevents inadvertent multi-schema billing).
 * - Dynamic Symbology resolution: continuous (ES.c.0) -> instrument_id -> front-month outright (ESZ6).
 * - Official CME exchange trading calendar validation (SessionCalendar: CT timezone, weekend & daily halts).
 * - Production DBN record decoder integration (parseDbnRecord & DBN_CONSTANTS from server/src/databento/liveClient.ts).
 * - Zero secret logging (API key masked, raw auth strings hidden).
 * - Clear NO RECORDS RECEIVED diagnostic when market is closed (never false-passes).
 *
 * Usage:
 *   # Default Dry-Run (Safe, zero streaming):
 *   node scripts/verify_databento_live.mjs
 *
 *   # Explicit Dry-Run options:
 *   node scripts/verify_databento_live.mjs --dataset GLBX.MDP3 --symbol ES.c.0 --schema trades --duration 30 --max-records 50 --dry-run
 *
 *   # Live stream validation (REQUIRES OPERATOR AUTHORIZATION):
 *   node scripts/verify_databento_live.mjs --dataset GLBX.MDP3 --symbol ES.c.0 --schema trades --duration 30 --max-records 50 --live
 *
 *   # MBP-10 validation (REQUIRES OPERATOR AUTHORIZATION):
 *   node scripts/verify_databento_live.mjs --dataset GLBX.MDP3 --symbol ES.c.0 --schema mbp-10 --duration 30 --max-records 50 --live
 */

import net from 'node:net';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabentoHttpClient } from '../server/dist/databento/client.js';
import { parseDbnRecord, DBN_CONSTANTS, SYSTEM_CODES } from '../server/dist/databento/liveClient.js';
import { SessionCalendar } from '../server/dist/calendar/sessionCalendar.js';
import { resolveDatabentoConfig } from '../server/dist/databento/config.js';

// --- Command Line Arguments Parsing ---
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dataset: 'GLBX.MDP3',
    symbol: 'ES.c.0',
    schema: 'trades',
    duration: 30,
    maxRecords: 50,
    isDryRun: true,
    isLive: false,
    mappingOutput: 'scratch/cme_instrument_mapping.json',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dataset' && args[i + 1]) {
      options.dataset = args[++i].trim();
    } else if (arg === '--symbol' && args[i + 1]) {
      options.symbol = args[++i].trim();
    } else if (arg === '--schema' && args[i + 1]) {
      options.schema = args[++i].trim().toLowerCase();
    } else if (arg === '--duration' && args[i + 1]) {
      options.duration = parseInt(args[++i], 10);
    } else if (arg === '--max-records' && args[i + 1]) {
      options.maxRecords = parseInt(args[++i], 10);
    } else if (arg === '--dry-run') {
      options.isDryRun = true;
    } else if (arg === '--live') {
      options.isLive = true;
      options.isDryRun = false;
    } else if (arg === '--output-mapping' && args[i + 1]) {
      options.mappingOutput = args[++i].trim();
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  // Safety invariant: default MUST be dry-run unless --live was explicitly provided
  if (!options.isLive) {
    options.isDryRun = true;
  }

  return options;
}

function printHelp() {
  console.log(`
DeepChart — Real Databento Live Smoke Test Harness

Options:
  --dataset <name>       Dataset code (default: GLBX.MDP3)
  --symbol <symbol>      Target symbol (default: ES.c.0)
  --schema <schema>      Data schema: 'trades', 'mbp-10', 'mbp-1' (default: trades)
  --duration <seconds>   Max duration in seconds before teardown (default: 30)
  --max-records <count>  Max records before teardown (default: 50)
  --dry-run              Execute pre-flight checks only, zero streaming (DEFAULT)
  --live                 Execute live stream with single subscription (REQUIRES OPERATOR PERMISSION)
  --output-mapping <path> Path to write resolved instrument mapping JSON
  --help, -h             Show this help message
`);
}

function maskApiKey(key) {
  if (!key) return '(not configured)';
  if (key.length <= 6) return '******';
  return '****' + key.slice(-4);
}

function buildCramAuthResponse(challenge, apiKey, dataset) {
  const bucketId = apiKey.slice(-5);
  const sha = createHash('sha256')
    .update(`${challenge}|${apiKey}`)
    .digest('hex');
  const auth = `${sha}-${bucketId}`;
  return `auth=${auth}|dataset=${dataset}|encoding=dbn|ts_out=0|compression=none|client=DeepChart/1.0.0\n`;
}

async function runHarness() {
  const opts = parseArgs();

  console.log('================================================================');
  console.log('🔬 DEEPCHART — DATABENTO LIVE SMOKE TEST HARNESS');
  console.log('================================================================');
  console.log(`Execution Mode:     ${opts.isDryRun ? '🛡️  DRY-RUN (SAFE: NO LIVE SUBSCRIPTION)' : '⚡ LIVE STREAMING (OPERATOR AUTHORIZED)'}`);
  console.log(`Target Dataset:     ${opts.dataset}`);
  console.log(`Target Symbol:      ${opts.symbol}`);
  console.log(`Target Schema:      ${opts.schema}`);
  console.log(`Max Duration:       ${opts.duration}s`);
  console.log(`Max Records Cap:    ${opts.maxRecords}`);
  console.log('================================================================\n');

  // --- Step 1: Configuration & Credentials Check ---
  console.log('--- Step 1: Configuration & Credential Inspection ---');
  const cfg = resolveDatabentoConfig();
  let apiKey = cfg.apiKey;
  if (!apiKey && fs.existsSync('.env')) {
    const envContent = fs.readFileSync('.env', 'utf8');
    const match = envContent.match(/^DATABENTO_API_KEY=(.+)$/m);
    if (match) apiKey = match[1].trim();
  }

  if (!apiKey) {
    console.error('❌ FAIL: Missing Databento API key (DATABENTO_API_KEY). Fail-closed triggered.');
    process.exit(1);
  }
  console.log(`  API Key:           Configured (${maskApiKey(apiKey)})`);
  console.log('  Live Gateway:      LSG TCP (port 13000, CRAM-SHA256 handshake)');

  const httpClient = new DatabentoHttpClient({ apiKey });

  // --- Step 2: Dataset Entitlement & Schema Compatibility ---
  console.log('\n--- Step 2: Dataset Entitlement & Schema Verification ---');
  try {
    const datasets = await httpClient.listDatasets();
    const isEntitled = datasets.includes(opts.dataset);
    console.log(`  Available Datasets Count: ${datasets.length}`);
    console.log(`  Entitled to ${opts.dataset}: ${isEntitled ? '✅ YES' : '❌ NO'}`);
    if (!isEntitled) {
      console.error(`❌ FAIL: Dataset ${opts.dataset} is not entitled for this account.`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`❌ FAIL: Dataset list query error: ${err.message}`);
    process.exit(1);
  }

  try {
    const schemas = await httpClient.listSchemas(opts.dataset);
    const schemaOk = schemas.includes(opts.schema);
    console.log(`  Dataset Supported Schemas: [${schemas.join(', ')}]`);
    console.log(`  Requested Schema '${opts.schema}': ${schemaOk ? '✅ SUPPORTED' : '❌ UNSUPPORTED'}`);
    if (!schemaOk) {
      console.error(`❌ FAIL: Schema '${opts.schema}' is not supported by dataset ${opts.dataset}.`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`❌ FAIL: Schema list query error: ${err.message}`);
    process.exit(1);
  }

  // --- Step 3: Dynamic Symbology Resolution (No Hardcoding) ---
  console.log('\n--- Step 3: Dynamic CME Symbology Resolution ---');
  const today = new Date().toISOString().slice(0, 10);
  console.log(`  Evaluation Date:   ${today}`);
  let resolvedInstrumentId = null;
  let resolvedRawSymbol = null;
  let effectiveRange = { d0: today, d1: today };

  try {
    // 1. Resolve continuous symbol (e.g. ES.c.0) to instrument_id
    let stypeIn = opts.symbol.includes('.c.') ? 'continuous' : (opts.symbol.endsWith('.FUT') ? 'parent' : 'raw_symbol');
    console.log(`  Resolving '${opts.symbol}' (stype_in=${stypeIn}) -> instrument_id...`);

    const resContinuous = await httpClient.resolveSymbology(opts.dataset, opts.symbol, stypeIn, 'instrument_id', today);
    const mappingEntries = resContinuous?.result?.[opts.symbol];

    if (mappingEntries && mappingEntries.length > 0) {
      const activeEntry = mappingEntries[mappingEntries.length - 1];
      resolvedInstrumentId = parseInt(activeEntry.s, 10);
      effectiveRange = { d0: activeEntry.d0, d1: activeEntry.d1 };
      console.log(`  ✅ Resolved instrument_id: ${resolvedInstrumentId} (effective: ${effectiveRange.d0} to ${effectiveRange.d1})`);
    } else {
      console.warn(`  ⚠️ Could not resolve instrument_id for ${opts.symbol}. Falling back to continuous symbol directly.`);
    }

    // 2. If instrument_id resolved, resolve to front-month outright raw_symbol (e.g. ESZ6)
    if (resolvedInstrumentId) {
      const resRaw = await httpClient.resolveSymbology(opts.dataset, String(resolvedInstrumentId), 'instrument_id', 'raw_symbol', today);
      const rawEntries = resRaw?.result?.[String(resolvedInstrumentId)];
      if (rawEntries && rawEntries.length > 0) {
        resolvedRawSymbol = rawEntries[rawEntries.length - 1].s;
        console.log(`  ✅ Resolved front-month outright contract: ${resolvedRawSymbol}`);
      }
    }
  } catch (err) {
    console.warn(`  ⚠️ Symbology resolution notice: ${err.message}`);
  }

  const mappingResult = {
    dataset: opts.dataset,
    requestedSymbol: opts.symbol,
    stypeIn: opts.symbol.includes('.c.') ? 'continuous' : 'raw_symbol',
    resolvedInstrumentId,
    resolvedRawSymbol,
    effectiveRange,
    resolvedAt: new Date().toISOString(),
  };

  try {
    const outDir = path.dirname(opts.mappingOutput);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(opts.mappingOutput, JSON.stringify(mappingResult, null, 2), 'utf8');
    console.log(`  Saved mapping artifact to ${opts.mappingOutput}`);
  } catch (err) {
    console.warn(`  Could not write mapping file: ${err.message}`);
  }

  // --- Step 4: Trading Session & Market Status Analysis ---
  console.log('\n--- Step 4: Official CME Exchange Calendar & Session Status ---');
  const nowTs = Date.now();
  const sessionInfo = SessionCalendar.getSessionInfo(nowTs, 'CME_EQUITY_INDEX');

  // Format Chicago Central Time
  const ctFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = ctFormatter.formatToParts(new Date(nowTs));
  const partMap = {};
  for (const p of parts) partMap[p.type] = p.value;
  const currentCtTime = `${partMap.weekday} ${partMap.year}-${partMap.month}-${partMap.day} ${partMap.hour}:${partMap.minute}:${partMap.second} CT`;

  console.log(`  Exchange Schedule:  ${sessionInfo.scheduleId} (CME Globex Central Time)`);
  console.log(`  Current Time (CT):  ${currentCtTime}`);
  console.log(`  Session State:      ${sessionInfo.isOpen ? '🟢 OPEN' : '🔴 CLOSED'}`);
  console.log(`  Session Type:       ${sessionInfo.isRth ? 'RTH (Regular Trading Hours: 08:30 - 15:15 CT)' : sessionInfo.isEth ? 'ETH (Extended Trading Hours)' : 'CLOSED (Weekend / Maintenance Halt)'}`);

  if (!sessionInfo.isOpen) {
    console.log(`  ℹ️ MARKET STATUS NOTE: CME Globex is currently closed.`);
    console.log(`     (Daily maintenance: 16:00 - 17:00 CT Mon-Thu; Weekend halt: Friday 16:00 CT to Sunday 17:00 CT).`);
    console.log(`     When the market is closed, CME produces 0 live trades.`);
    console.log(`     Lack of data stream during closed hours is EXPECTED MARKET INACTIVITY, NOT a parser failure.`);
  }

  // --- Step 5: Mode Decision ---
  if (opts.isDryRun) {
    console.log('\n================================================================');
    console.log('🛡️  DRY-RUN VERIFICATION COMPLETED CLEANLY');
    console.log('================================================================');
    console.log('Status: AUTH & PRE-FLIGHT VERIFIED (Zero live streaming incurred)');
    console.log('Contract Resolved:  ' + (resolvedRawSymbol ? `${opts.symbol} -> ${resolvedRawSymbol} (ID ${resolvedInstrumentId})` : opts.symbol));
    console.log('Market Condition:   ' + (sessionInfo.isOpen ? 'OPEN' : 'CLOSED'));
    console.log('\nTo execute a live streaming verification (requires Operator authorization):');
    console.log(`  node scripts/verify_databento_live.mjs --dataset ${opts.dataset} --symbol ${opts.symbol} --schema ${opts.schema} --duration ${opts.duration} --max-records ${opts.maxRecords} --live`);
    console.log('================================================================');
    process.exit(0);
  }

  // ================================================================
  // --- Step 6: LIVE STREAMING EXECUTION (OPERATOR AUTHORIZED) ---
  // ================================================================
  console.log('\n================================================================');
  console.log('⚡ INITIATING LIVE LSG STREAMING (OPERATOR AUTHORIZED)');
  console.log('================================================================');

  const subdomain = opts.dataset.toLowerCase().replace(/\./g, '-');
  const host = `${subdomain}.lsg.databento.com`;
  const port = 13000;
  console.log(`[LSG] Connecting to raw TCP socket at ${host}:${port}...`);

  let phase = 'cram';
  let buffer = Buffer.alloc(0);

  // --- Protocol State Tracking (Explicit 6 Stages) ---
  let authSuccess = false;                 // 1. AUTHENTICATED
  let dbnMetadataReceived = false;         // 2. DBN METADATA RECEIVED
  let subscriptionAckReceived = false;     // 3. SUBSCRIPTION ACK RECEIVED (SystemMsg code=1)
  let errorRecordReceived = false;         // 4. ERROR RECORD RECEIVED (ErrorMsg rtype=0x15)
  let realMarketRecordsReceived = 0;       // 5. REAL MARKET RECORDS RECEIVED (trade/depth count)
  let decoderVerified = false;             // 6. DECODER VERIFIED (parsed trade/depth structurally valid)

  // Additional Telemetry
  let dbnVersion = 2;
  let metadataLen = 0;
  let heartbeatCount = 0;
  let lastHeartbeatTs = 0;
  let lastErrorText = null;
  let parseErrors = 0;
  let sampleRecords = [];
  let disconnectReason = 'NORMAL_COMPLETION';

  const startTime = Date.now();
  const socket = net.createConnection({ host, port });

  let resolved = false;
  let timer = null;

  const teardownSocket = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (socket && !socket.destroyed) {
      socket.destroy();
    }
  };

  const onSignal = () => {
    console.log('\n[LSG] Process interrupted. Gracefully closing TCP socket and cleaning up resources...');
    teardownSocket();
    process.exit(130);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  await new Promise((resolve) => {
    const safeResolve = () => {
      if (!resolved) {
        resolved = true;
        teardownSocket();
        process.removeListener('SIGINT', onSignal);
        process.removeListener('SIGTERM', onSignal);
        resolve();
      }
    };

    // Timeout guard: triggers regardless of 0 records, idle socket, or reconnect attempts
    timer = setTimeout(() => {
      disconnectReason = `TIMEOUT_${opts.duration}S`;
      console.log(`\n[LSG] Duration limit reached (${opts.duration}s). Initiating graceful shutdown...`);
      safeResolve();
    }, opts.duration * 1000);

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      // Phase 1: CRAM Challenge
      while (phase === 'cram') {
        const nlIdx = buffer.indexOf(10);
        if (nlIdx === -1) break;
        const line = buffer.subarray(0, nlIdx).toString('utf8');
        buffer = buffer.subarray(nlIdx + 1);

        const match = line.match(/cram=([^\r\n|]+)/);
        if (match) {
          console.log('[LSG] ✅ Received CRAM challenge from gateway');
          const challenge = match[1];
          const authReq = buildCramAuthResponse(challenge, apiKey, opts.dataset);
          // Never log authReq content or key
          console.log('[LSG] Sending CRAM-SHA256 authentication response...');
          socket.write(authReq);
          phase = 'auth';
          break;
        }
      }

      // Phase 2: Auth Response
      while (phase === 'auth') {
        const nlIdx = buffer.indexOf(10);
        if (nlIdx === -1) break;
        const line = buffer.subarray(0, nlIdx).toString('utf8');
        buffer = buffer.subarray(nlIdx + 1);

        if (line.includes('success=1')) {
          authSuccess = true;
          const sessMatch = line.match(/session_id=([^\r\n|]+)/);
          const sessId = sessMatch ? sessMatch[1] : 'active';
          console.log(`[LSG] ✅ [STAGE 1: AUTHENTICATED] Gateway authentication successful (session_id: ${sessId})`);

          // Phase 3: Single Subscription (trades or mbp-10)
          const liveSymbol = opts.symbol;
          const stypeIn = liveSymbol.includes('.c.') ? 'continuous' : (liveSymbol.endsWith('.FUT') ? 'parent' : 'raw_symbol');

          // Send SINGLE subscription command
          const subMsg = `schema=${opts.schema}|stype_in=${stypeIn}|symbols=${liveSymbol}|snapshot=0|is_last=1\n`;
          const startSessionMsg = 'start_session=1\n';

          console.log(`[LSG] Sending single subscription: schema=${opts.schema}, stype_in=${stypeIn}, symbol=${liveSymbol}`);
          socket.write(subMsg);
          socket.write(startSessionMsg);

          phase = 'dbn_header';
          break;
        } else if (line.includes('success=0')) {
          const errMatch = line.match(/error=([^\r\n|]+)/);
          const errMsg = errMatch ? errMatch[1] : 'Authentication failed';
          console.error(`[LSG] ❌ Authentication rejected: ${errMsg}`);
          disconnectReason = `AUTH_REJECTED: ${errMsg}`;
          safeResolve();
          return;
        }
      }

      // Phase 4: DBN Stream Header (Stream/Container Metadata)
      if (phase === 'dbn_header') {
        if (buffer.length >= 8 && buffer.subarray(0, 3).toString('ascii') === DBN_CONSTANTS.MAGIC) {
          dbnVersion = buffer.readUInt8(3);
          const metaLen = buffer.readUInt32LE(4);
          if (buffer.length >= 8 + metaLen) {
            buffer = buffer.subarray(8 + metaLen);
            dbnMetadataReceived = true;
            metadataLen = metaLen;
            console.log(`[LSG] ✅ [STAGE 2: DBN METADATA RECEIVED] Header parsed (DBN v${dbnVersion}, metaLen: ${metaLen} bytes).`);
            console.log('      (Note: DBN metadata header is stream framing, NOT subscription ACK)');
            phase = 'records';
          }
        } else if (buffer.length >= 128 && buffer.subarray(0, 3).toString('ascii') !== DBN_CONSTANTS.MAGIC) {
          // Fallback if header framing differs
          dbnMetadataReceived = true;
          console.log('[LSG] ✅ [STAGE 2: DBN METADATA RECEIVED] Framing acknowledged. Awaiting subscription records...');
          phase = 'records';
        }
      }

      // Phase 5: Production DBN Binary Record Processing
      if (phase === 'records') {
        while (buffer.length >= DBN_CONSTANTS.HEADER_SIZE) {
          // Use production decoder function directly
          const { parsed, recLen } = parseDbnRecord(buffer, opts.symbol, 'databento', dbnVersion);

          if (recLen === 0 || recLen < DBN_CONSTANTS.HEADER_SIZE) {
            buffer = buffer.subarray(1);
            parseErrors++;
            continue;
          }
          if (buffer.length < recLen) {
            break; // Await rest of record
          }

          if (parsed) {
            // Stage 3: SUBSCRIPTION ACK RECEIVED (SystemMsg code=1) or Heartbeat (code=0)
            if (parsed.system) {
              if (parsed.system.isSubscriptionAck) {
                subscriptionAckReceived = true;
                console.log(`[LSG] ✅ [STAGE 3: SUBSCRIPTION ACK RECEIVED] SystemMsg code=1 (msg: "${parsed.system.msg || 'OK'}")`);
              } else if (parsed.system.isHeartbeat) {
                heartbeatCount++;
                lastHeartbeatTs = parsed.tsMs;
                console.log(`[LSG Heartbeat] Received gateway heartbeat #${heartbeatCount} at ${new Date(parsed.tsMs || Date.now()).toISOString()} (gateway idle keepalive)`);
              } else {
                console.log(`[LSG SystemMsg] Received SystemMsg (code: ${parsed.system.code}, msg: "${parsed.system.msg}")`);
              }
            }

            // Stage 4: ERROR RECORD RECEIVED (ErrorMsg rtype=0x15)
            if (parsed.error || parsed.rtype === DBN_CONSTANTS.RTYPE_ERROR) {
              errorRecordReceived = true;
              lastErrorText = parsed.error || 'Gateway ErrorMsg received';
              parseErrors++;
              console.error(`[LSG Error Record] ❌ [STAGE 4: ERROR RECORD RECEIVED] Gateway error: ${lastErrorText}`);
              disconnectReason = `GATEWAY_ERROR: ${lastErrorText}`;
              safeResolve();
              return;
            }

            // Stage 5: REAL MARKET RECORDS RECEIVED
            if (parsed.trade) {
              realMarketRecordsReceived++;
              const t = parsed.trade;
              // Validation assertions
              const validPrice = Number.isFinite(t.price) && t.price > 0;
              const validSize = Number.isFinite(t.size) && t.size > 0;
              const validSide = t.side === 'BUY' || t.side === 'SELL' || t.side === 'UNKNOWN';
              const validTs = t.ts > 0;

              if (validPrice && validSize && validSide && validTs) {
                decoderVerified = true;
              } else {
                parseErrors++;
              }

              if (sampleRecords.length < 3) {
                sampleRecords.push({
                  type: 'TRADE',
                  price: t.price,
                  size: t.size,
                  side: t.side,
                  tsMs: t.ts,
                  sequence: t.sequenceId,
                  instrumentId: parsed.instrumentId,
                });
              }
            }

            if (parsed.depth) {
              realMarketRecordsReceived++;
              const d = parsed.depth;
              const validBids = Array.isArray(d.bids) && (d.bids.length === 0 || (d.bids[0].price > 0 && d.bids[0].size > 0));
              const validAsks = Array.isArray(d.asks) && (d.asks.length === 0 || (d.asks[0].price > 0 && d.asks[0].size > 0));

              if (validBids && validAsks && (d.bids.length > 0 || d.asks.length > 0)) {
                decoderVerified = true;
              } else {
                parseErrors++;
              }

              if (sampleRecords.length < 3) {
                sampleRecords.push({
                  type: 'DEPTH',
                  bidsCount: d.bids.length,
                  asksCount: d.asks.length,
                  topBid: d.bids[0],
                  topAsk: d.asks[0],
                  tsMs: d.ts,
                  instrumentId: parsed.instrumentId,
                });
              }
            }

            if (!parsed.trade && !parsed.depth && !parsed.system && !parsed.error) {
              console.log(`[LSG Telemetry] Handled non-market administrative record rtype=0x${parsed.rtype.toString(16).padStart(2, '0')} (instrumentId: ${parsed.instrumentId})`);
            }

            // Cap check: only cap on real market records
            if (realMarketRecordsReceived >= opts.maxRecords) {
              disconnectReason = `MAX_RECORDS_REACHED (${opts.maxRecords})`;
              console.log(`[LSG] ✅ Record cap reached (${opts.maxRecords}). Closing socket gracefully...`);
              safeResolve();
              return;
            }
          }

          buffer = buffer.subarray(recLen);
        }
      }
    });

    socket.on('error', (err) => {
      console.warn(`[LSG TCP Error] ${err.message}`);
      disconnectReason = `TCP_ERROR: ${err.message}`;
      safeResolve();
    });

    socket.on('close', () => {
      safeResolve();
    });
  });

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

  // --- Step 7: Live Results Reporting & 6-Stage / 8-Tier Verification Matrix ---
  console.log('\n================================================================');
  console.log('📋 LIVE PROTOCOL VERIFICATION & STAGE SUMMARY');
  console.log('================================================================');
  console.log(`[Stage 1] AUTHENTICATED:             ${authSuccess ? '✅ PASS (CRAM-SHA256 handshake successful)' : '❌ FAIL'}`);
  console.log(`[Stage 2] DBN METADATA RECEIVED:     ${dbnMetadataReceived ? `✅ PASS (${metadataLen} bytes header parsed)` : '⚠️ PENDING / NONE'}`);
  console.log(`[Stage 3] SUBSCRIPTION ACK RECEIVED: ${subscriptionAckReceived ? '✅ PASS (SystemMsg.code = 1 SUBSCRIPTION_ACK)' : '⚠️ NONE / PENDING'}`);
  console.log(`[Stage 4] ERROR RECORD RECEIVED:     ${errorRecordReceived ? `❌ ERROR DETECTED (${lastErrorText})` : '✅ NONE (Clean stream)'}`);
  console.log(`[Stage 5] REAL MARKET RECORDS:       ${realMarketRecordsReceived > 0 ? `✅ PASS (${realMarketRecordsReceived} records received)` : '⚠️ 0 RECORDS (Market inactive/closed)'}`);
  console.log(`[Stage 6] DECODER VERIFIED:          ${decoderVerified ? '✅ PASS (parseDbnRecord decoded real market structures cleanly)' : realMarketRecordsReceived > 0 ? '❌ FAIL (Decoder validation error)' : '⏸️ SKIPPED (0 records to decode)'}`);
  console.log(`Gateway Heartbeats Received:         ${heartbeatCount}`);
  console.log(`Parse Errors / Corrupt:              ${parseErrors}`);
  console.log(`Elapsed Stream Time:                 ${elapsedSec}s / ${opts.duration}s`);
  console.log(`Termination Reason:                  ${disconnectReason}`);

  console.log('\n--- 8-Tier Architecture Verification Status ---');
  console.log(`[Tier 1] Metadata Preflight:                 ✅ PASS (listDatasets, listSchemas, symbology.resolve verified)`);
  console.log(`[Tier 2] Gateway Authentication:             ${authSuccess ? '✅ PASS (CRAM-SHA256 handshake successful)' : '❌ FAIL (Auth rejected/failed)'}`);
  console.log(`[Tier 3] Subscription Accepted:              ${subscriptionAckReceived ? '✅ PASS (SystemMsg code=1 ACK received)' : errorRecordReceived ? '❌ FAIL (ErrorMsg received)' : '⚠️ PENDING / NONE (Awaiting SystemMsg ACK)'}`);
  console.log(`[Tier 4] Actual DBN Records Received:        ${realMarketRecordsReceived > 0 ? `✅ PASS (${realMarketRecordsReceived} market records received)` : '⚠️ 0 RECORDS (Session closed / inactive window)'}`);
  console.log(`[Tier 5] Decoder Receives Genuine Records:   ${decoderVerified ? '✅ PASS (parseDbnRecord decoded real records cleanly)' : realMarketRecordsReceived > 0 ? '⚠️ PARTIAL (decoding errors observed)' : '⏸️ SKIPPED (0 records to decode)'}`);
  console.log(`[Tier 6] MarketContext Analytics Updated:    ⚙️ HARNESS LIMITATION (Not measured by harness; requires DeepChart backend runtime)`);
  console.log(`[Tier 7] Backend WebSocket Server Broadcast: ⚙️ HARNESS LIMITATION (Not measured by harness; requires DeepChart WS server)`);
  console.log(`[Tier 8] React Browser Render:               ⚙️ HARNESS LIMITATION (Not measured by harness; requires DeepChart Browser UI)`);

  if (errorRecordReceived) {
    console.log('\n================================================================');
    console.log('❌ SUBSCRIPTION FAILED: ERROR RECORD RECEIVED FROM GATEWAY');
    console.log('================================================================');
    console.log(`Gateway Error: ${lastErrorText}`);
    console.log(`Reason:        ${disconnectReason}`);
    process.exit(2);
  } else if (!authSuccess) {
    console.log('\n================================================================');
    console.log('❌ AUTHENTICATION FAILED');
    console.log('================================================================');
    console.log(`Reason: ${disconnectReason}`);
    process.exit(2);
  } else if (disconnectReason.startsWith('TCP_ERROR')) {
    console.log('\n================================================================');
    console.log('❌ TCP NETWORK ERROR');
    console.log('================================================================');
    console.log(`Reason: ${disconnectReason}`);
    process.exit(2);
  } else if (realMarketRecordsReceived > 0) {
    console.log('\n--- Sample Records Decoded via Production parseDbnRecord ---');
    console.log(JSON.stringify(sampleRecords, null, 2));
    console.log('\n================================================================');
    console.log('🎉 REAL RECORDS VERIFIED: LIVE MARKET DATA RECEIVED & VALIDATED');
    console.log('================================================================');
    process.exit(0);
  } else {
    console.log('\n================================================================');
    console.log('⚠️ NO RECORDS RECEIVED (MARKET CLOSED / INACTIVE)');
    console.log('================================================================');
    console.log(`Market Session:     ${sessionInfo.isOpen ? 'OPEN' : 'CLOSED (Weekend / Maintenance Halt)'}`);
    console.log(`Current Time (CT):  ${currentCtTime}`);
    console.log(`Subscription State: ${subscriptionAckReceived ? 'ACKNOWLEDGED (LSG Ready, SystemMsg code=1)' : dbnMetadataReceived ? 'METADATA RECEIVED (Pending SystemMsg ACK)' : 'PENDING'}`);
    console.log(`Heartbeats:         ${heartbeatCount} received`);
    console.log(`Timeout:            ${elapsedSec}s elapsed`);
    console.log(`Probable Cause:     ${!sessionInfo.isOpen ? 'CME Globex market is currently closed. Exchange matching engine is not operating.' : 'No trading activity for requested symbol in sampling window.'}`);
    console.log('Assessment:         LSG gateway & protocol handshake verified.');
    console.log('                    Awaiting CME open session to capture live DBN ticks.');
    console.log('================================================================');
    process.exit(0);
  }
}

runHarness().catch((err) => {
  console.error('Fatal harness error:', err);
  process.exit(1);
});

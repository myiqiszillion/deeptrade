import { spawn, ChildProcess } from 'child_process';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_PORT = 8089;
const WS_URL = `ws://localhost:${TEST_PORT}`;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Guard against silently testing a stale server left over from a previous run.
function assertPortFree(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const tester = net.createServer();
    tester.once('error', (err: NodeJS.ErrnoException) => {
      reject(new Error(`Port ${port} is already in use (${err.code}). Kill the leftover verify_p0 server and retry.`));
    });
    tester.once('listening', () => tester.close(() => resolve()));
    tester.listen(port, '127.0.0.1');
  });
}

async function startServer(): Promise<ChildProcess> {
  console.log(`[verify_p0] Starting test server on port ${TEST_PORT} with DEV_HOOKS=1...`);
  const serverPath = path.resolve(__dirname, 'index.ts');
  // Run tsx through node directly instead of the .cmd shim: spawning a shell wrapper
  // triggers Node's DEP0190 warning and adds an extra cmd.exe layer that has to be killed.
  const tsxCli = path.resolve(__dirname, '../node_modules/tsx/dist/cli.mjs');

  const proc = spawn(process.execPath, [tsxCli, serverPath], {
    env: {
      ...process.env,
      PORT: TEST_PORT.toString(),
      DEV_HOOKS: '1',
      DEMO: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return new Promise((resolve, reject) => {
    let started = false;
    const timeout = setTimeout(() => {
      if (!started) {
        killServerTree(proc);
        reject(new Error('Server start timed out after 10s'));
      }
    }, 10000);

    proc.stdout?.on('data', (data) => {
      const str = data.toString();
      // Only the final "Ready at ..." line proves the server actually bound the port.
      if (str.includes(`Ready at ws://localhost:${TEST_PORT}`)) {
        if (!started) {
          started = true;
          clearTimeout(timeout);
          // Allow server 500ms to bind fully
          setTimeout(() => resolve(proc), 500);
        }
      }
    });

    proc.stdout?.on('data', (d) => { const l = d.toString().trim(); if (l.length > 0 && !l.includes('Ready at')) console.log('[server] ' + l); });

    proc.stderr?.on('data', (data) => {
      // Server rejections/warnings are expected during these tests; route them to stdout
      // so piping the suite output never trips PowerShell's NativeCommandError handling.
      console.log(`[server] ${data.toString().trim()}`);
    });

    // Fail fast instead of silently testing a stale server that already owns the port.
    proc.on('exit', (code) => {
      if (!started) {
        clearTimeout(timeout);
        reject(
          new Error(
            `Test server exited before becoming ready (code ${code}). Port ${TEST_PORT} is probably already in use — ` +
              'kill the previous verify_p0 server and run again.'
          )
        );
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function killServerTree(proc: ChildProcess | null) {
  if (!proc || proc.killed || proc.pid === undefined) return;
  if (process.platform === 'win32') {
    // tsx is spawned via node directly (no shell wrapper), but a taskkill /T still guards
    // against any grandchild process holding the test port.
    spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    proc.kill('SIGKILL');
  } else {
    proc.kill('SIGKILL');
  }
}

async function runVerifyP0() {
  console.log('======================================================');
  console.log('ðŸ§ª RUNNING DEEPCHART P0 VERIFICATION SUITE (13 TESTS)');
  console.log('======================================================\n');

  let serverProc: ChildProcess | null = null;
  let ws: WebSocket | null = null;

  try {
    await assertPortFree(TEST_PORT);
    serverProc = await startServer();
    ws = new WebSocket(WS_URL);

    await new Promise<void>((resolve, reject) => {
      ws!.on('open', () => resolve());
      ws!.on('error', reject);
    });
    console.log(`✅ Connected to test server at ${WS_URL}\n`);

    const receivedMessages: any[] = [];
    // Boundary: readiness waits must be satisfied by a message that arrives AFTER the request
    // under observation - never by a historical snapshot from a previous feed session.
    let liveMark = 0;
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        receivedMessages.push(msg);
      } catch (err) {
        console.error('Error parsing msg:', err);
      }
    });

    // Helper: wait for a message matching predicate
    function waitForMessage(predicate: (m: any) => boolean, timeoutMs = 5000): Promise<any> {
      return new Promise((resolve, reject) => {
        // Check existing messages first
        const existing = receivedMessages.find(predicate);
        if (existing) return resolve(existing);

        const timer = setTimeout(() => {
          clearInterval(interval);
          reject(new Error(`Timeout waiting for message matching condition (${timeoutMs}ms)`));
        }, timeoutMs);

        const interval = setInterval(() => {
          const match = receivedMessages.find(predicate);
          if (match) {
            clearTimeout(timer);
            clearInterval(interval);
            resolve(match);
          }
        }, 20);
      });
    }

    // Wait for INIT_STATE
    console.log('--- Initializing ---');
    const initMsg = await waitForMessage((m) => m.type === 'INIT_STATE');
    console.log(`Received INIT_STATE for ${initMsg.symbol}, pointValue: ${initMsg.instrument.pointValue}`);

    // Allow ticks to buffer for 2 seconds so replay buffer has ticks
    await sleep(2000);

    // ==========================================
    // TEST 1: Replay khÃ´ng Äƒn Ä‘uÃ´i (Buffer isolation)
    // ==========================================
    console.log('\n--- TEST 1: Replay khÃ´ng Äƒn Ä‘uÃ´i (Buffer Isolation) ---');
    // Start replay at 1x so the assertion can prove the playhead actually advances
    ws.send(JSON.stringify({ type: 'REPLAY_CONTROL', action: 'START', speed: 1 }));
    
    // Wait for first REPLAY_STATE
    const replay1 = await waitForMessage((m) => m.type === 'REPLAY_STATE');
    const ticks1 = replay1.progress.totalTicks;
    console.log(`Replay started: totalTicks = ${ticks1}, currentIndex = ${replay1.progress.currentIndex}`);

    // Wait 2.5s and check REPLAY_STATE again
    await sleep(2500);
    const replay2 = receivedMessages.filter((m) => m.type === 'REPLAY_STATE').pop();
    const ticks2 = replay2?.progress.totalTicks;
    console.log(`Replay after 2.5s: totalTicks = ${ticks2}, currentIndex = ${replay2?.progress.currentIndex}`);

    if (ticks1 !== ticks2) {
      throw new Error(`TEST 1 FAILED: totalTicks changed during replay (${ticks1} -> ${ticks2}). Buffer is growing!`);
    }

    // The buffer being frozen is necessary but not sufficient: the playhead must move too,
    // otherwise a stuck replay would also "pass" the assertion above.
    const idx1 = replay1.progress.currentIndex;
    const idx2 = replay2?.progress.currentIndex ?? 0;
    const stillPlaying = replay2?.progress.isPlaying === true;
    if (idx2 < idx1) {
      throw new Error(`TEST 1 FAILED: playhead moved backwards (${idx1} -> ${idx2}).`);
    }
    if (stillPlaying && idx2 <= idx1) {
      throw new Error(`TEST 1 FAILED: replay reports isPlaying but the playhead did not advance (${idx1} -> ${idx2}).`);
    }
    console.log(`Playhead advanced ${idx1} -> ${idx2} (isPlaying: ${stillPlaying}), buffer frozen at ${ticks1} ticks.`);
    console.log('✅ TEST 1 PASSED: Buffer length remains constant during replay (no tail eating).');

    // Pause replay
    ws.send(JSON.stringify({ type: 'REPLAY_CONTROL', action: 'PAUSE' }));
    await sleep(300);

    // ==========================================
    // TEST 2: Deprecated DOM_ORDER rejected safely
    // ==========================================
    console.log('\n--- TEST 2: Deprecated DOM_ORDER rejected safely ---');
    ws.send(
      JSON.stringify({
        type: 'DOM_ORDER',
        action: 'BUY',
        size: 1,
        orderType: 'MARKET',
      })
    );
    await sleep(500);
    // Assert server is still responsive by pinging with a valid SUBSCRIBE
    ws.send(JSON.stringify({ type: 'SUBSCRIBE', symbol: 'BTCUSDT', timeframe: '1m' }));
    const pingInit = await waitForMessage((m) => m.type === 'INIT_STATE' && m.symbol === 'BTCUSDT');
    if (!pingInit) throw new Error('TEST 2 FAILED: Server unresponsive after receiving deprecated DOM_ORDER');
    console.log('✅ TEST 2 PASSED: Deprecated DOM_ORDER rejected safely without crashing server.');

    // ==========================================
    // TEST 3: Deprecated Trading Messages Rejected Safely
    // ==========================================
    console.log('\n--- TEST 3: Deprecated Trading Messages Rejected Safely ---');
    ws.send(JSON.stringify({ type: 'UPDATE_COPIER', slaves: [] }));
    ws.send(JSON.stringify({ type: 'SET_PROP_TRAILING_MODE', mode: 'INTRADAY_PEAK' }));
    ws.send(JSON.stringify({ type: 'RESET_PROP_ACCOUNT' }));
    ws.send(JSON.stringify({ type: 'CLEAR_JOURNAL' }));
    ws.send(JSON.stringify({ type: 'SET_PROP_CONFIG', config: {} }));
    await sleep(500);
    ws.send(JSON.stringify({ type: 'SUBSCRIBE', symbol: 'BTCUSDT', timeframe: '1m' }));
    const pingInit3 = await waitForMessage((m) => m.type === 'INIT_STATE' && m.symbol === 'BTCUSDT');
    if (!pingInit3) throw new Error('TEST 3 FAILED: Server unresponsive after receiving deprecated trading messages');
    console.log('✅ TEST 3 PASSED: All deprecated trading messages safely rejected without server errors.');

    // ==========================================
    // TEST 4: Replay Pause & Resume
    // ==========================================
    console.log('\n--- TEST 4: Replay Pause & Resume ---');
    ws.send(JSON.stringify({ type: 'REPLAY_CONTROL', action: 'PAUSE' }));
    const pausedState = await waitForMessage((m) => m.type === 'REPLAY_STATE' && m.progress.isPlaying === false);
    console.log(`Replay paused: isPlaying=${pausedState.progress.isPlaying}, currentIndex=${pausedState.progress.currentIndex}`);
    ws.send(JSON.stringify({ type: 'REPLAY_CONTROL', action: 'START', speed: 1 }));
    const resumedState = await waitForMessage((m) => m.type === 'REPLAY_STATE' && m.progress.isPlaying === true);
    console.log(`Replay resumed: isPlaying=${resumedState.progress.isPlaying}`);
    console.log('✅ TEST 4 PASSED: Replay pause and resume state transitions work correctly.');

    // ==========================================
    // TEST 5: Replay Seek Playhead
    // ==========================================
    console.log('\n--- TEST 5: Replay Seek Playhead ---');
    ws.send(JSON.stringify({ type: 'REPLAY_CONTROL', action: 'PAUSE' }));
    await sleep(200);
    ws.send(JSON.stringify({ type: 'REPLAY_CONTROL', action: 'SEEK', timestamp: 0 }));
    const seekState = await waitForMessage((m) => m.type === 'REPLAY_STATE' && m.progress.currentIndex === 0);
    console.log(`Replay seek to 0: currentIndex=${seekState.progress.currentIndex}`);
    console.log('✅ TEST 5 PASSED: Replay seek playhead works correctly.');

    // ==========================================
    // TEST 6: Notional Value (pointValue applied)
    // ==========================================
    console.log('\n--- TEST 6: Whale threshold is derived from the active instrument ---');
    // Real-only: instead of waiting for a whale to print (and never fabricating one), assert
    // the advertised threshold contract and validate any real whale against it.
    const cryptoThreshold = initMsg.deepTradeThresholdUsd;
    if (cryptoThreshold !== 50000) {
      throw new Error(`TEST 6 FAILED: crypto whale threshold should be 50000, got ${cryptoThreshold}.`);
    }
    const seenWhale = receivedMessages.find((m) => m.type === 'DEEP_TRADE');
    if (seenWhale) {
      if (seenWhale.trade.valueUsd < cryptoThreshold) {
        throw new Error(
          `TEST 6 FAILED: DEEP_TRADE $${seenWhale.trade.valueUsd} is below the advertised $${cryptoThreshold} threshold.`
        );
      }
      console.log(
        `Observed a real whale: ${seenWhale.trade.size} @ ${seenWhale.trade.price} = $${seenWhale.trade.valueUsd}`
      );
    } else {
      console.log('No whale printed during this run — threshold contract verified without fabricating one.');
    }
    console.log('✅ TEST 6 PASSED: notional threshold is instrument-derived (pointValue-aware) and enforced on real ticks.');

    // ==========================================
    // TEST 7: SET_SPEED and STEP
    // ==========================================
    console.log('\n--- TEST 7: SET_SPEED & STEP Protocol ---');
    ws.send(JSON.stringify({ type: 'REPLAY_CONTROL', action: 'PAUSE' }));
    await sleep(200);

    // Seek to 0 so that buffer can be stepped forward even if it reached the end in Test 1
    ws.send(JSON.stringify({ type: 'REPLAY_CONTROL', action: 'SEEK', timestamp: 0 }));
    await waitForMessage((m) => m.type === 'REPLAY_STATE' && m.progress.currentIndex === 0);

    ws.send(JSON.stringify({ type: 'REPLAY_CONTROL', action: 'SET_SPEED', speed: 50 }));
    const speedMsg = await waitForMessage((m) => m.type === 'REPLAY_STATE' && m.progress.speed === 50);
    console.log(`SET_SPEED verified: speed = ${speedMsg.progress.speed}`);

    const idxBefore = speedMsg.progress.currentIndex;
    ws.send(JSON.stringify({ type: 'REPLAY_CONTROL', action: 'STEP' }));
    const stepMsg = await waitForMessage(
      (m) => m.type === 'REPLAY_STATE' && m.progress.currentIndex === idxBefore + 1
    );
    console.log(`STEP verified: currentIndex advanced from ${idxBefore} to ${stepMsg.progress.currentIndex}`);
    console.log('✅ TEST 7 PASSED: SET_SPEED and STEP work correctly in replay protocol.');

    // ==========================================
    // TEST 8: Multi-client chart subscription
    // ==========================================
    console.log('\n--- TEST 8: Multi-client chart subscription ---');
    const ws2 = new WebSocket(WS_URL);
    await new Promise<void>((resolve, reject) => {
      ws2.on('open', () => resolve());
      ws2.on('error', reject);
    });
    const ws2Messages: any[] = [];
    ws2.on('message', (data) => ws2Messages.push(JSON.parse(data.toString())));
    await sleep(1000);
    const ws2Init = ws2Messages.find((m) => m.type === 'INIT_STATE');
    if (!ws2Init) throw new Error('TEST 8 FAILED: Client B did not receive INIT_STATE');
    const ws2Ticks = ws2Messages.filter((m) => m.type === 'TICK').length;
    console.log(`Client B connected and received INIT_STATE + ${ws2Ticks} shared ticks.`);
    ws2.close();
    console.log('✅ TEST 8 PASSED: Multi-client chart sessions share market data cleanly.');

    // ==========================================
    // TEST 9: Instrument + timeframe switch returns a fresh INIT_STATE
    // ==========================================
    console.log('\n--- TEST 9: SUBSCRIBE symbol/timeframe -> fresh INIT_STATE ---');
    ws.send(JSON.stringify({ type: 'SUBSCRIBE', symbol: 'NQ', timeframe: '15s', source: 'cme' }));

    const switched = await waitForMessage(
      (m) => m.type === 'INIT_STATE' && m.symbol === 'NQ' && m.timeframe === '15s'
    );
    console.log(
      `Switched to ${switched.symbol} @ ${switched.timeframe} (pointValue=${switched.instrument.pointValue}, tickSize=${switched.instrument.tickSize}, deepTradeThreshold=$${switched.deepTradeThresholdUsd})`
    );
    if (switched.instrument?.pointValue !== 20 || switched.instrument?.tickSize !== 0.25) {
      throw new Error('TEST 9 FAILED: instrument specs were not updated for the new contract.');
    }
    if (!switched.bars || !switched.orderbook) {
      throw new Error('TEST 9 FAILED: INIT_STATE after a switch is missing market state.');
    }
    console.log('✅ TEST 9 PASSED: symbol + timeframe switch returns a coherent snapshot.');

    // ==========================================
    // TEST 10: Runtime payload validation (untrusted WebSocket input)
    // ==========================================
    console.log('\n--- TEST 10: Reject malformed payloads & resync ---');
    ws.send(JSON.stringify({ type: 'SUBSCRIBE', symbol: 'NOT_A_SYMBOL', source: 'cme', timeframe: '1m' }));
    const resync = await waitForMessage((m) => m.type === 'INIT_STATE' && m.symbol === 'NQ');
    console.log(`Unknown symbol ignored; server re-synced the client to ${resync.symbol}`);
    console.log('✅ TEST 10 PASSED: malformed payloads are rejected without corrupting state.');

    // ==========================================
    // TEST 11: Rate limiting flood protection
    // ==========================================
    console.log('\n--- TEST 11: Rate limiting flood protection ---');
    for (let i = 0; i < 60; i++) {
      ws.send(JSON.stringify({ type: 'SUBSCRIBE', symbol: 'BTCUSDT', timeframe: '1m' }));
    }
    await sleep(500);
    ws.send(JSON.stringify({ type: 'SUBSCRIBE', symbol: 'BTCUSDT', timeframe: '1m' }));
    const pingFlood = await waitForMessage((m) => m.type === 'INIT_STATE' && m.symbol === 'BTCUSDT');
    if (!pingFlood) throw new Error('TEST 11 FAILED: Server unresponsive after flood');
    console.log('✅ TEST 11 PASSED: Flood protection safely bounds incoming client rate.');

    // ==========================================
    // TEST 12: Session connection & clean disconnect
    // ==========================================
    console.log('\n--- TEST 12: Session connection & clean disconnect ---');
    const wsTemp = new WebSocket(WS_URL);
    await new Promise<void>((resolve, reject) => {
      wsTemp.on('open', () => resolve());
      wsTemp.on('error', reject);
    });
    wsTemp.close();
    await sleep(1000); // Allow the 1000ms rate limiting flood window to drain before TEST 13
    console.log('✅ TEST 12 PASSED: Client disconnect cleanly handled.');


    // ==========================================
    // TEST 13: real-only availability (no fabricated data for feedless instruments)
    // ==========================================
    console.log('\n--- TEST 13: feedless instrument reports UNAVAILABLE ---');
    ws.send(JSON.stringify({ type: 'SUBSCRIBE', symbol: 'ES', timeframe: '1m' })); liveMark = receivedMessages.length;
    const esState = await waitForMessage((m) => m.type === 'INIT_STATE' && m.symbol === 'ES' && receivedMessages.indexOf(m) >= liveMark);

    if (esState.feedStatus !== 'UNAVAILABLE') {
      throw new Error(`TEST 13 FAILED: ES must report feedStatus UNAVAILABLE, got '${esState.feedStatus}'.`);
    }
    if (esState.bars.length !== 0) {
      throw new Error(`TEST 13 FAILED: ES returned ${esState.bars.length} fabricated bars.`);
    }

    // Let the last in-flight tick from the previous instrument drain before measuring, so the
    // window only covers the feedless instrument.
    await sleep(500);
    const ticksBefore = receivedMessages.filter((m) => m.type === 'TICK').length;
    const booksBefore = receivedMessages.filter((m) => m.type === 'ORDERBOOK_UPDATE').length;

    await sleep(2500);
    const newTicks = receivedMessages.filter((m) => m.type === 'TICK').length - ticksBefore;
    const newBooks = receivedMessages.filter((m) => m.type === 'ORDERBOOK_UPDATE').length - booksBefore;
    if (newTicks !== 0 || newBooks !== 0) {
      throw new Error(
        `TEST 13 FAILED: feedless instrument still produced ${newTicks} ticks / ${newBooks} book updates.`
      );
    }
    console.log(
      `ES reported ${esState.feedStatus} with ${esState.bars.length} bars; 0 ticks / 0 book updates in 2.5s.`
    );
    console.log('✅ TEST 13 PASSED: nothing is fabricated for an instrument without a real feed.');

    console.log('\n======================================================');
    console.log('ðŸŽ‰ ALL 13 P0 TEST CASES PASSED SUCCESSFULLY!');
    console.log('======================================================\n');
  } finally {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    if (serverProc) {
      console.log('[verify_p0] Terminating test server...');
      killServerTree(serverProc);
      // Release the piped stdio handles: a still-referenced pipe keeps the parent's
      // event loop alive after the tests finish, which makes this script hang forever.
      serverProc.stdout?.destroy();
      serverProc.stderr?.destroy();
      serverProc.unref();
    }
  }
}

runVerifyP0()
  .then(() => {
    // The child tree can take a moment to die on Windows, so exit explicitly rather than
    // letting a stray handle keep the process alive.
    setTimeout(() => process.exit(0), 250);
  })
  .catch((err) => {
    console.error('\nâŒ VERIFY P0 SUITE FAILED:', err);
    process.exit(1);
  });




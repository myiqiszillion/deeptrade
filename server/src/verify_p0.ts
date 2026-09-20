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
  console.log('🧪 RUNNING DEEPCHART P0 VERIFICATION SUITE (10 TESTS)');
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
    // TEST 1: Replay không ăn đuôi (Buffer isolation)
    // ==========================================
    console.log('\n--- TEST 1: Replay không ăn đuôi (Buffer Isolation) ---');
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
    // TEST 2: LIMIT Rest (Resting Order Placed)
    // ==========================================
    console.log('\n--- TEST 2: LIMIT Order Rest & No Immediate Fill ---');
    const farLimitOrderId = 'test_far_limit_1';
    ws.send(
      JSON.stringify({
        type: 'DOM_ORDER',
        action: 'BUY',
        size: 1,
        orderType: 'LIMIT',
        price: 1000, // Very far below market ~5800
        orderId: farLimitOrderId,
      })
    );

    const ackPlaced = await waitForMessage(
      (m) => m.type === 'ORDER_ACK' && m.action === 'PLACED' && m.orderId === farLimitOrderId
    );
    console.log(`Received ORDER_ACK: PLACED for ${ackPlaced.orderId} at price ${ackPlaced.price}`);

    const openOrdersMsg = await waitForMessage(
      (m) => m.type === 'OPEN_ORDERS' && m.orders.some((o: any) => o.id === farLimitOrderId)
    );
    console.log(`OPEN_ORDERS contains ${openOrdersMsg.orders.length} order(s).`);

    // Ensure no JOURNAL_UPDATE for this trade within 2 seconds
    const journalBefore = receivedMessages.filter((m) => m.type === 'JOURNAL_UPDATE').length;
    await sleep(2000);
    const journalAfter = receivedMessages.filter((m) => m.type === 'JOURNAL_UPDATE').length;
    if (journalAfter > journalBefore) {
      throw new Error(`TEST 2 FAILED: Far limit order was unexpectedly filled!`);
    }
    console.log('✅ TEST 2 PASSED: LIMIT order correctly rests, broadcasts OPEN_ORDERS, and does not fill prematurely.');

    // ==========================================
    // TEST 3: LIMIT Marketable (Instant Hit)
    // ==========================================
    console.log('\n--- TEST 3: LIMIT Marketable (Instant Hit) ---');
    const marketableOrderId = 'test_marketable_1';
    // Buy limit 5 points above current market price -> guaranteed marketable, fills on next tick without blowing drawdown
    const latestTick = receivedMessages.filter((m) => m.type === 'TICK').pop();
    const currentPrice = latestTick?.tick?.price || 5850;
    const marketablePrice = Math.round((currentPrice + 5.0) * 100) / 100;

    ws.send(
      JSON.stringify({
        type: 'DOM_ORDER',
        action: 'BUY',
        size: 1,
        orderType: 'LIMIT',
        price: marketablePrice,
        orderId: marketableOrderId,
      })
    );

    const fillTrade = await waitForMessage(
      (m) => m.type === 'JOURNAL_UPDATE' && m.trade.status === 'OPEN' && m.trade.size === 1 && m.trade.entryPrice === marketablePrice
    );
    console.log(`Marketable LIMIT filled: Trade ID ${fillTrade.trade.id}, Entry: ${fillTrade.trade.entryPrice}`);

    // Cleanup: flatten the position opened by TEST 3 so the remaining tests start flat.
    ws.send(JSON.stringify({ type: 'DOM_ORDER', action: 'FLATTEN', size: 0 }));
    const closedTrade = await waitForMessage(
      (m) => m.type === 'JOURNAL_UPDATE' && m.trade.status === 'CLOSED' && m.trade.symbol === initMsg.symbol
    );
    console.log(`TEST 3 cleanup: flattened ${closedTrade.trade.id}, realized pnl = ${closedTrade.trade.pnl}`);
    console.log('✅ TEST 3 PASSED: Marketable LIMIT fills upon tick crossing.');

    // ==========================================
    // TEST 4: CANCEL by ID & CANCEL ALL
    // ==========================================
    console.log('\n--- TEST 4: CANCEL by ID & CANCEL ALL ---');
    const cancelOrderId = 'test_cancel_id_1';
    ws.send(
      JSON.stringify({
        type: 'DOM_ORDER',
        action: 'BUY',
        size: 1,
        orderType: 'LIMIT',
        price: 1001,
        orderId: cancelOrderId,
      })
    );
    await waitForMessage((m) => m.type === 'ORDER_ACK' && m.action === 'PLACED' && m.orderId === cancelOrderId);

    // Cancel by ID
    ws.send(
      JSON.stringify({
        type: 'DOM_ORDER',
        action: 'CANCEL',
        orderId: cancelOrderId,
      })
    );

    await waitForMessage((m) => m.type === 'ORDER_ACK' && m.action === 'CANCELLED' && m.orderId === cancelOrderId);
    const openAfterCancel1 = await waitForMessage(
      (m) => m.type === 'OPEN_ORDERS' && !m.orders.some((o: any) => o.id === cancelOrderId)
    );
    console.log(`Order ${cancelOrderId} cancelled. Open orders: ${openAfterCancel1.orders.length}`);

    // Now place another order and CANCEL ALL
    ws.send(
      JSON.stringify({
        type: 'DOM_ORDER',
        action: 'BUY',
        size: 1,
        orderType: 'LIMIT',
        price: 1002,
        orderId: 'test_to_cancel_all',
      })
    );
    await waitForMessage((m) => m.type === 'ORDER_ACK' && m.action === 'PLACED');

    ws.send(JSON.stringify({ type: 'DOM_ORDER', action: 'CANCEL' }));
    await waitForMessage((m) => m.type === 'ORDER_ACK' && m.action === 'CANCELLED');
    const emptyOrders = await waitForMessage((m) => m.type === 'OPEN_ORDERS' && m.orders.length === 0);
    console.log(`CANCEL ALL executed. Open orders count: ${emptyOrders.orders.length}`);
    console.log('✅ TEST 4 PASSED: Both CANCEL by ID and CANCEL ALL successfully update OPEN_ORDERS.');

    // ==========================================
    // TEST 5: Contract Cap & Reject
    // ==========================================
    console.log('\n--- TEST 5: Contract Cap & ORDER_REJECT ---');
    ws.send(
      JSON.stringify({
        type: 'DOM_ORDER',
        action: 'BUY',
        size: 100, // Limit is 5 minis
        orderType: 'MARKET',
        orderId: 'test_cap_reject',
      })
    );

    const rejectMsg = await waitForMessage((m) => m.type === 'ORDER_REJECT' && m.orderId === 'test_cap_reject');
    console.log(`Received ORDER_REJECT as expected: "${rejectMsg.reason}"`);
    console.log('✅ TEST 5 PASSED: Exceeding contract limit triggers ORDER_REJECT.');

    // ==========================================
    // TEST 6: Notional Value (pointValue applied)
    // ==========================================
    console.log('\n--- TEST 6: Tape / Deep Trade Notional with pointValue ---');
    const deepTradeMsg = await waitForMessage((m) => m.type === 'DEEP_TRADE', 8000);
    const expectedNotional = deepTradeMsg.trade.price * deepTradeMsg.trade.size * 50; // ES pointValue = 50
    const diff = Math.abs(deepTradeMsg.trade.valueUsd - expectedNotional);
    console.log(
      `DEEP_TRADE: Price ${deepTradeMsg.trade.price}, Size ${deepTradeMsg.trade.size}, valueUsd: $${deepTradeMsg.trade.valueUsd} (Expected: $${expectedNotional})`
    );
    if (diff > 1) {
      throw new Error(`TEST 6 FAILED: Notional value mismatch. Expected ~${expectedNotional}, got ${deepTradeMsg.trade.valueUsd}`);
    }
    console.log('✅ TEST 6 PASSED: Notional calculation correctly multiplies instrument pointValue.');

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
    // TEST 8: Lockout Dev Hook & Breach Isolation
    // ==========================================
    console.log('\n--- TEST 8: Lockout Dev Hook & Breach Single Fire ---');
    // First place a resting order to see it gets cleared on breach
    ws.send(
      JSON.stringify({
        type: 'DOM_ORDER',
        action: 'BUY',
        size: 1,
        orderType: 'LIMIT',
        price: 1005,
        orderId: 'order_before_breach',
      })
    );
    await waitForMessage((m) => m.type === 'ORDER_ACK' && m.action === 'PLACED');

    // Trigger lockout via DEV_HOOKS: set maxTrailingDrawdown to 0.01 (instant breach on equity)
    const breachAlertsCountBefore = receivedMessages.filter((m) => m.type === 'PROP_BREACH_ALERT').length;

    ws.send(
      JSON.stringify({
        type: 'SET_PROP_CONFIG',
        config: {
          maxTrailingDrawdown: 0.01,
        },
      })
    );

    const breachMsg = await waitForMessage((m) => m.type === 'PROP_BREACH_ALERT');
    console.log(`Received PROP_BREACH_ALERT: ${breachMsg.breachType} - "${breachMsg.message}"`);

    // Check open orders cleared
    await sleep(300);
    const clearedOpen = receivedMessages.filter((m) => m.type === 'OPEN_ORDERS').pop();
    if (clearedOpen && clearedOpen.orders.length > 0) {
      throw new Error(`TEST 8 FAILED: Open orders were not cleared on breach!`);
    }
    console.log('Open orders successfully cleared on breach.');

    // Try placing a new order: should be rejected
    ws.send(
      JSON.stringify({
        type: 'DOM_ORDER',
        action: 'BUY',
        size: 1,
        orderType: 'MARKET',
        orderId: 'order_after_breach',
      })
    );

    const postBreachReject = await waitForMessage(
      (m) => m.type === 'ORDER_REJECT' && m.orderId === 'order_after_breach'
    );
    console.log(`Post-breach order rejected as expected: "${postBreachReject.reason}"`);

    // Ensure PROP_BREACH_ALERT fired only once for this breach
    await sleep(1000);
    const breachAlertsCountAfter = receivedMessages.filter((m) => m.type === 'PROP_BREACH_ALERT').length;
    if (breachAlertsCountAfter - breachAlertsCountBefore !== 1) {
      throw new Error(
        `TEST 8 FAILED: PROP_BREACH_ALERT fired ${breachAlertsCountAfter - breachAlertsCountBefore} times instead of exactly once!`
      );
    }
    console.log('PROP_BREACH_ALERT fired exactly once (idempotent breach).');

    // RESET_PROP_ACCOUNT must be able to unlock the account again (H3 regression guard)
    ws.send(JSON.stringify({ type: 'RESET_PROP_ACCOUNT' }));
    const resetState = await waitForMessage(
      (m) => m.type === 'PROP_STATE_UPDATE' && m.state.isLockedOut === false
    );
    console.log(`RESET_PROP_ACCOUNT verified: isLockedOut = ${resetState.state.isLockedOut}, dailyLossRemaining = ${resetState.state.dailyLossRemaining}`);
    console.log('✅ TEST 8 PASSED: Lockout clears resting orders, fires once, and rejects subsequent orders.');

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
    console.log('\n--- TEST 10: Reject malformed order payloads ---');

    ws.send(JSON.stringify({ type: 'DOM_ORDER', action: 'BUY', size: 0.5, orderType: 'MARKET', orderId: 'bad_fraction' }));
    const fracReject = await waitForMessage((m) => m.type === 'ORDER_REJECT' && m.orderId === 'bad_fraction');
    console.log(`Fractional futures size rejected: "${fracReject.reason}"`);

    ws.send(JSON.stringify({ type: 'DOM_ORDER', action: 'BUY', size: 0, orderType: 'MARKET', orderId: 'bad_zero' }));
    const zeroReject = await waitForMessage((m) => m.type === 'ORDER_REJECT' && m.orderId === 'bad_zero');
    console.log(`Zero size rejected: "${zeroReject.reason}"`);

    ws.send(JSON.stringify({ type: 'DOM_ORDER', action: 'BUY', size: '2', orderType: 'MARKET', orderId: 'bad_string' }));
    const strReject = await waitForMessage((m) => m.type === 'ORDER_REJECT' && m.orderId === 'bad_string');
    console.log(`Non-numeric size rejected: "${strReject.reason}"`);

    ws.send(JSON.stringify({ type: 'DOM_ORDER', action: 'BUY', size: 1, orderType: 'LIMIT', price: 'oops', orderId: 'bad_price' }));
    const priceReject = await waitForMessage((m) => m.type === 'ORDER_REJECT' && m.orderId === 'bad_price');
    console.log(`Non-numeric LIMIT price rejected: "${priceReject.reason}"`);

    ws.send(JSON.stringify({ type: 'SUBSCRIBE', symbol: 'NOT_A_SYMBOL', source: 'cme', timeframe: '1m' }));
    const resync = await waitForMessage((m) => m.type === 'INIT_STATE' && m.symbol === 'NQ');
    console.log(`Unknown symbol ignored; server re-synced the client to ${resync.symbol}`);
    console.log('✅ TEST 10 PASSED: malformed payloads are rejected without corrupting state.');

    console.log('\n======================================================');
    console.log('🎉 ALL 10 P0 TEST CASES PASSED SUCCESSFULLY!');
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
    console.error('\n❌ VERIFY P0 SUITE FAILED:', err);
    process.exit(1);
  });

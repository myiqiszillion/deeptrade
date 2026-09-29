import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

async function getFreePort(): Promise<number> {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = (probe.address() as net.AddressInfo).port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runReplayVerification() {
  console.log('=== STARTING REAL REPLAY VERIFICATION ===');
  const port = await getFreePort();
  const root = fileURLToPath(new URL('../', import.meta.url));
  const serverPath = fileURLToPath(new URL('../server/dist/index.js', import.meta.url));

  const env = {
    ...process.env,
    NODE_ENV: 'development', // Uses real data/market_data.sqlite
    PORT: String(port),
    HOST: '127.0.0.1',
    DEV_HOOKS: '1',
    DATABENTO_TRANSPORT_READY: '0',
    DEFAULT_SYMBOL: 'ES',
  };

  const server = spawn(process.execPath, [serverPath], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let exited = false;
  server.on('exit', () => { exited = true; });

  try {
    let ready = false;
    server.stdout.on('data', (d) => {
      if (d.toString().includes('Ready at') || d.toString().includes('Web terminal')) ready = true;
    });
    server.stderr.on('data', () => {});

    const deadline = Date.now() + 6000;
    while (!ready && Date.now() < deadline) {
      if (exited) throw new Error('Server exited prematurely');
      await sleep(50);
    }
    assert.ok(ready, 'Server started');

    const wsUrl = `ws://127.0.0.1:${port}`;
    const ws = new WebSocket(wsUrl);
    const messages: any[] = [];
    ws.on('message', (data) => {
      try {
        messages.push(JSON.parse(data.toString()));
      } catch {}
    });

    await once(ws, 'open');
    console.log('[WS] Connected to WebSocket server');

    function waitForMessage(predicate: (m: any) => boolean, timeoutMs = 6000): Promise<any> {
      return new Promise((resolve, reject) => {
        const found = messages.find(predicate);
        if (found) return resolve(found);
        const timer = setTimeout(() => {
          clearInterval(interval);
          reject(new Error(`Timeout waiting for message matching condition (${timeoutMs}ms)`));
        }, timeoutMs);
        const interval = setInterval(() => {
          const match = messages.find(predicate);
          if (match) {
            clearTimeout(timer);
            clearInterval(interval);
            resolve(match);
          }
        }, 20);
      });
    }

    // 1. Initial State
    const init = await waitForMessage((m) => m.type === 'INIT_STATE');
    assert.equal(init.symbol, 'ES');
    console.log('[INIT] Received INIT_STATE for ES');

    // 2. Start Replay for ES (which has 7,110 real trades in data/market_data.sqlite)
    console.log('[Replay] Sending REPLAY_CONTROL START at 5x speed for ES...');
    const markStart = messages.length;
    ws.send(JSON.stringify({ type: 'REPLAY_CONTROL', action: 'START', speed: 5 }));

    const replayState1 = await waitForMessage((m) => m.type === 'REPLAY_STATE');
    assert.ok(replayState1.progress.totalTicks > 0, `Total ticks must be > 0 (found ${replayState1.progress.totalTicks})`);
    console.log(`[Replay] Initial replay state: totalTicks=${replayState1.progress.totalTicks}, currentIndex=${replayState1.progress.currentIndex}`);

    // Wait 1.5 seconds for ticks to stream
    await sleep(1500);

    const streamedTicks = messages.slice(markStart).filter((m) => m.type === 'TICK');
    console.log(`[Replay] Received ${streamedTicks.length} TICK messages during playback`);
    assert.ok(streamedTicks.length > 0, 'Replay must stream actual TICK messages during playback');

    // Verify tick authenticity: NOT fake seeds!
    for (const msg of streamedTicks) {
      const t = msg.tick;
      assert.ok(t, 'Message must contain tick object');
      assert.ok(!t.id.includes('replay_seed'), `Tick ID "${t.id}" MUST NOT contain replay_seed`);
      assert.ok(typeof t.price === 'number' && t.price > 4000 && t.price < 8000, `Price ${t.price} must be realistic for ES`);
      assert.ok(typeof t.timestamp === 'number' && t.timestamp > 1500000000000, `Timestamp ${t.timestamp} must be valid epoch ms`);
      assert.ok(typeof t.size === 'number' && t.size > 0, `Size ${t.size} must be positive`);
      assert.ok(t.side === 'buy' || t.side === 'sell' || t.side === 'unknown', `Side ${t.side} must be valid`);
    }
    console.log('  -> PASS: All streamed ticks are verified real market trades with authentic prices and timestamps.');

    // Verify progress moved forward
    const latestReplay = messages.filter((m) => m.type === 'REPLAY_STATE').pop();
    assert.ok(latestReplay.progress.currentIndex > replayState1.progress.currentIndex, 'Playhead must advance');
    console.log(`[Replay] Playhead advanced from ${replayState1.progress.currentIndex} to ${latestReplay.progress.currentIndex}`);

    // 3. Pause Replay
    console.log('[Replay] Sending REPLAY_CONTROL PAUSE...');
    ws.send(JSON.stringify({ type: 'REPLAY_CONTROL', action: 'PAUSE' }));
    await sleep(400);
    const pausedState = messages.filter((m) => m.type === 'REPLAY_STATE').pop();
    assert.equal(pausedState.progress.isPlaying, false, 'isPlaying must be false when paused');
    const pausedIdx = pausedState.progress.currentIndex;
    await sleep(500);
    const afterPauseState = messages.filter((m) => m.type === 'REPLAY_STATE').pop();
    assert.equal(afterPauseState.progress.currentIndex, pausedIdx, 'Playhead must NOT advance while paused');
    console.log('  -> PASS: Replay successfully paused; playhead frozen.');

    // 4. Seek Replay
    console.log('[Replay] Sending REPLAY_CONTROL SEEK to 0...');
    const markSeek = messages.length;
    ws.send(JSON.stringify({ type: 'REPLAY_CONTROL', action: 'SEEK', timestamp: 0 }));
    const seekState = await waitForMessage((m) => m.type === 'REPLAY_STATE' && m.progress.currentIndex === 0);
    assert.equal(seekState.progress.currentIndex, 0, 'Playhead must be at index 0 after seek');
    console.log('  -> PASS: Replay seek to 0 succeeded.');

    // 5. Test instrument with NO historical trade data
    console.log('[Replay Fail-Closed] Switching to instrument without historical trades (e.g. M2K)...');
    ws.send(JSON.stringify({ type: 'REPLAY_CONTROL', action: 'RETURN_TO_LIVE' }));
    await sleep(200);
    ws.send(JSON.stringify({ type: 'SUBSCRIBE', symbol: 'M2K', timeframe: '1m' }));
    await waitForMessage((m) => m.type === 'INIT_STATE' && m.symbol === 'M2K');
    console.log('[INIT] Subscribed to M2K');

    const markEmpty = messages.length;
    console.log('[Replay Fail-Closed] Requesting REPLAY START on empty instrument...');
    ws.send(JSON.stringify({ type: 'REPLAY_CONTROL', action: 'START', speed: 1 }));

    const errorMsg = await waitForMessage((m) => m.type === 'ERROR' && m.code === 'NO_REPLAY_DATA');
    assert.equal(errorMsg.code, 'NO_REPLAY_DATA', 'Must return NO_REPLAY_DATA error code');
    assert.match(errorMsg.message, /No market replay data available for M2K/i);

    // Verify NO synthetic ticks or replay_state was emitted
    const emptyTicks = messages.slice(markEmpty).filter((m) => m.type === 'TICK');
    assert.equal(emptyTicks.length, 0, 'MUST NOT fabricate ticks when no data is available');
    const fakeSeedTicks = messages.slice(markEmpty).filter((m) => m.tick?.id?.includes('replay_seed'));
    assert.equal(fakeSeedTicks.length, 0, 'MUST NOT contain any replay_seed ticks');
    console.log('  -> PASS: Instrument without data correctly failed closed with NO_REPLAY_DATA; zero fake ticks fabricated.');

    ws.close();
    console.log('\n✅ ALL REAL REPLAY VERIFICATION CASES PASSED!\n');
  } finally {
    if (!exited) {
      const stopped = once(server, 'exit');
      server.kill();
      await stopped;
    }
    server.stdout.destroy();
    server.stderr.destroy();
  }
}

runReplayVerification().catch((err) => {
  console.error('❌ Replay Verification Failed:', err);
  process.exit(1);
});

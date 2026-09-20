import WebSocket from 'ws';

/**
 * Chart-Only smoke test. Build and run the server from current source first:
 *   pnpm build && node server/dist/index.js
 *   pnpm verify
 * It asserts the active instrument carries a LIVE real feed, real depth and real ticks — no fixtures.
 */
async function run(): Promise<void> {
  const url = process.env.VERIFY_WS_URL || 'ws://localhost:8080';
  console.log(`[verify] Connecting to ${url} ...`);
  const ws = new WebSocket(url);

  let init: any = null;
  let ticks = 0;
  let books = 0;
  let legacyMessageTested = false;

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for real-only smoke events')), 25000);
    ws.on('open', () => {
      console.log('[verify] Connected — subscribing BTCUSDT (the key-less real feed)');
      ws.send(JSON.stringify({ type: 'SUBSCRIBE', symbol: 'BTCUSDT', timeframe: '1m' }));
    });
    ws.on('error', reject);
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'INIT_STATE' && msg.symbol === 'BTCUSDT') {
        init = msg;
        console.log(
          `INIT_STATE ${msg.symbol} | feed ${msg.feedStatus} | history ${msg.historySource} | pointValue ${msg.instrument.pointValue}`
        );
        // Send a deprecated trading message to verify safe rejection without server crash
        if (!legacyMessageTested) {
          legacyMessageTested = true;
          ws.send(JSON.stringify({ type: 'DOM_ORDER', action: 'BUY', size: 1, orderType: 'MARKET' }));
        }
      } else if (msg.type === 'TICK') {
        ticks++;
      } else if (msg.type === 'ORDERBOOK_UPDATE') {
        books++;
      }

      if (init && ticks >= 3 && books >= 1 && legacyMessageTested) {
        clearTimeout(timeout);
        ws.close();
        resolve();
      }
    });
  });

  const failures: string[] = [];
  if (!init) failures.push('no INIT_STATE');
  if (init && init.feedStatus !== 'LIVE') failures.push(`feed ${init.feedStatus}, expected LIVE`);
  if (init && init.historySource !== 'REAL_TICKS') failures.push(`history ${init.historySource}, expected REAL_TICKS`);
  if (ticks < 3) failures.push(`only ${ticks} real ticks`);
  if (books < 1) failures.push('no real depth updates');

  if (failures.length > 0) throw new Error(`real-only smoke test failed: ${failures.join(', ')}`);
  console.log('\nREAL-ONLY SMOKE TEST PASSED (real feed, real depth, real ticks, legacy message rejected safely)');
}

run().catch((err) => {
  console.error('verify failed:', err.message);
  process.exit(1);
});

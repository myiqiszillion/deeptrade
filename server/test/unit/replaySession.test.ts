import assert from 'node:assert/strict';
import { FUTURES_INSTRUMENTS } from '../../src/futuresConfig.js';
import { ReplayDataSource, ReplaySession } from '../../src/replaySession.js';
import { ChartSession } from '../../src/session.js';
import { Tick, WSServerMessage } from '../../src/types.js';

class MockWebSocket {
  public readyState = 1; // WebSocket.OPEN
  public bufferedAmount = 0;
  public sentMessages: WSServerMessage[] = [];

  public send(data: string): void {
    this.sentMessages.push(JSON.parse(data));
  }

  public close(): void {
    this.readyState = 3;
  }
}

export async function runReplaySessionTests(): Promise<void> {
  console.log('[unit/replaySession.test] Running ReplaySession unit tests...');

  const mockWs = new MockWebSocket();
  const session = new ChartSession(mockWs as any);

  const sampleTicks: Tick[] = [
    { id: '1', timestamp: 1700000000000, price: 5000.0, size: 5, side: 'buy' },
    { id: '2', timestamp: 1700000001000, price: 5000.25, size: 3, side: 'sell' },
    { id: '3', timestamp: 1700000002000, price: 5000.5, size: 10, side: 'buy' },
  ];

  const replay = new ReplaySession(session, 'ES', FUTURES_INSTRUMENTS.ES, '1m', sampleTicks);
  assert.equal(session.mode, 'REPLAY');

  // 1. Step control
  replay.step();
  assert.equal(replay.replayEngine.getProgress().currentIndex, 1);

  replay.step();
  assert.equal(replay.replayEngine.getProgress().currentIndex, 2);

  // 2. Seek control
  replay.seek(0);
  assert.equal(replay.replayEngine.getProgress().currentIndex, 0);

  // 3. Speed control
  replay.setSpeed(5);
  assert.equal(replay.replayEngine.getProgress().speed, 5);

  // 4. Persistent ReplayDataSource Loading
  const mockSource: ReplayDataSource = {
    async loadTicks(options) {
      assert.equal(options.symbol, 'ES');
      assert.equal(options.provider, 'tradovate');
      return [
        { id: 'p1', timestamp: 1700000010000, price: 5001.0, size: 2, side: 'buy' },
        { id: 'p2', timestamp: 1700000011000, price: 5001.25, size: 4, side: 'sell' },
      ];
    },
  };

  const loadedCount = await replay.loadFromSource(mockSource, { provider: 'tradovate', limit: 10 });
  assert.equal(loadedCount, 2);
  assert.equal(replay.replayEngine.getProgress().totalTicks, 2);

  // 5. Cleanup / Dispose
  replay.dispose();
  assert.equal(session.mode, 'LIVE');

  console.log('  [PASS] All ReplaySession unit tests passed.');
}

if (process.argv[1]?.endsWith('replaySession.test.ts') || process.argv[1]?.endsWith('replaySession.test.js')) {
  runReplaySessionTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

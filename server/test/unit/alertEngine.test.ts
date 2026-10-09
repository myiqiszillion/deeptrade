import assert from 'node:assert';
import { AlertEngine } from '../../src/alerts/alertEngine.js';
import { marketDataStore } from '../../src/storage/marketDataStore.js';
import { AlertEvent } from '../../src/alerts/types.js';
import { Tick, VolumeProfileData } from '../../src/types.js';

export async function runAlertEngineTests() {
  console.log('[unit/alertEngine.test] Running Order Flow Alert Engine unit tests...');

  const engine = new AlertEngine();
  const testUserId = 'test_trader_1';

  // Clear any existing test rules
  const existing = marketDataStore.getAlertRulesForUser(testUserId);
  for (const r of existing) {
    marketDataStore.deleteAlertRule(r.id, testUserId);
  }

  // Track delivered events
  const deliveredAlerts: Array<{ userId: string; event: AlertEvent }> = [];
  engine.setDeliveryCallback((userId, event) => {
    deliveredAlerts.push({ userId, event });
  });

  // Test 1: Stacked Diagonal Imbalance Rule Evaluation
  {
    const ruleId = marketDataStore.createAlertRule({
      userId: testUserId,
      symbol: 'ES',
      type: 'STACKED_IMBALANCE',
      threshold: 3.0, // 300% imbalance ratio
      timeframe: '1m',
      cooldownSec: 10,
      enabled: true,
    }).id;

    // Construct a FootprintBar with 3 consecutive diagonal buy imbalances
    // Prices: 5700.00, 5700.25, 5700.50, 5700.75
    // Level 0: 5700.00: bid=10, ask=50
    // Level 1: 5700.25: bid=5,  ask=60 (vs Level 0 bid 10: 60/10 = 6.0x -> imbalance!)
    // Level 2: 5700.50: bid=5,  ask=80 (vs Level 1 bid 5:  80/5  = 16.0x -> imbalance!)
    // Level 3: 5700.75: bid=5,  ask=100 (vs Level 2 bid 5: 100/5 = 20.0x -> imbalance!)
    const bar: any = {
      time: 1700000000000,
      open: 5700.0,
      high: 5701.0,
      low: 5699.75,
      close: 5700.75,
      volume: 500,
      delta: 200,
      levels: {
        5700.0: { bid: 10, ask: 50, delta: 40, totalVolume: 60 },
        5700.25: { bid: 5, ask: 60, delta: 55, totalVolume: 65 },
        5700.50: { bid: 5, ask: 80, delta: 75, totalVolume: 85 },
        5700.75: { bid: 5, ask: 100, delta: 95, totalVolume: 105 },
      },
    };

    deliveredAlerts.length = 0;
    engine.evaluateFootprintBar('ES', bar, 0.25);

    assert.strictEqual(deliveredAlerts.length, 1, 'Should trigger exactly 1 stacked imbalance alert');
    assert.strictEqual(deliveredAlerts[0].userId, testUserId, 'Delivered alert must target rule owner');
    assert.strictEqual(deliveredAlerts[0].event.type, 'STACKED_IMBALANCE');
    assert.strictEqual(deliveredAlerts[0].event.severity, 'CRITICAL');

    // Test Cooldown: immediate re-evaluation must be suppressed
    engine.evaluateFootprintBar('ES', bar, 0.25);
    assert.strictEqual(deliveredAlerts.length, 1, 'Repeated trigger within cooldown must be suppressed');

    marketDataStore.deleteAlertRule(ruleId, testUserId);
  }

  // Test 2: Order Flow Absorption Rule Evaluation
  {
    const ruleId = marketDataStore.createAlertRule({
      userId: testUserId,
      symbol: 'ES',
      type: 'ABSORPTION',
      threshold: 50, // 50 contracts absorbed
      cooldownSec: 10,
      enabled: true,
    }).id;

    deliveredAlerts.length = 0;
    engine.evaluateAbsorption('ES', {
      id: 'abs_1',
      price: 5700.25,
      volume: 85,
      timestamp: 1700000005000,
      side: 'buy_absorption',
      description: 'Passive bid absorbed aggressive selling',
    });

    assert.strictEqual(deliveredAlerts.length, 1, 'Should trigger absorption alert when volume >= 50');
    assert.strictEqual(deliveredAlerts[0].event.type, 'ABSORPTION');
    assert.strictEqual(deliveredAlerts[0].event.price, 5700.25);

    marketDataStore.deleteAlertRule(ruleId, testUserId);
  }

  // Test 3: Large Trade (Whale) Evaluation
  {
    const ruleId = marketDataStore.createAlertRule({
      userId: testUserId,
      symbol: 'ES',
      type: 'LARGE_TRADE',
      threshold: 50, // 50 contracts
      cooldownSec: 10,
      enabled: true,
    }).id;

    deliveredAlerts.length = 0;
    const smallTick: Tick = {
      id: 't_1',
      price: 5700.5,
      size: 5,
      timestamp: 1700000010000,
      side: 'buy',
    };
    engine.evaluateTick('ES', smallTick);
    assert.strictEqual(deliveredAlerts.length, 0, 'Small tick (5 lots) must not trigger');

    const whaleTick: Tick = {
      id: 't_2',
      price: 5700.5,
      size: 120,
      timestamp: 1700000011000,
      side: 'buy',
    };
    engine.evaluateTick('ES', whaleTick);
    assert.strictEqual(deliveredAlerts.length, 1, 'Whale tick (120 lots >= 50) must trigger alert');
    assert.strictEqual(deliveredAlerts[0].event.type, 'LARGE_TRADE');

    marketDataStore.deleteAlertRule(ruleId, testUserId);
  }

  // Test 4: Key Profile Level Touch (POC / VAH / VAL)
  {
    const ruleId = marketDataStore.createAlertRule({
      userId: testUserId,
      symbol: 'ES',
      type: 'POC_VAH_VAL',
      threshold: 0.5, // 0.5 points tolerance
      cooldownSec: 10,
      enabled: true,
    }).id;

    const profile: VolumeProfileData = {
      poc: 5700.0,
      vah: 5710.0,
      val: 5690.0,
      totalVolume: 10000,
      levels: [],
    };

    deliveredAlerts.length = 0;
    const tickTouchingPoc: Tick = {
      id: 't_3',
      price: 5700.25,
      size: 2,
      timestamp: 1700000020000,
      side: 'buy',
    };
    engine.evaluateTick('ES', tickTouchingPoc, profile);

    assert.strictEqual(deliveredAlerts.length, 1, 'Price within tolerance of POC must trigger alert');
    assert.strictEqual(deliveredAlerts[0].event.type, 'POC_VAH_VAL');
    assert.strictEqual(deliveredAlerts[0].event.metadata?.levelName, 'POC');

    marketDataStore.deleteAlertRule(ruleId, testUserId);
  }

  // Test 5: Liquidity Wall Evaluation
  {
    const ruleId = marketDataStore.createAlertRule({
      userId: testUserId,
      symbol: 'ES',
      type: 'LIQUIDITY_WALL',
      threshold: 200, // 200 resting contracts
      cooldownSec: 10,
      enabled: true,
    }).id;

    const bookWithWall: any = {
      bids: [[5700.0, 45], [5699.75, 280]], // 280 contracts wall
      asks: [[5700.25, 30]],
      lastUpdateId: 100,
    };

    deliveredAlerts.length = 0;
    engine.evaluateOrderbook('ES', bookWithWall);

    assert.strictEqual(deliveredAlerts.length, 1, 'Liquidity wall of 280 >= 200 must trigger alert');
    assert.strictEqual(deliveredAlerts[0].event.type, 'LIQUIDITY_WALL');
    assert.strictEqual(deliveredAlerts[0].event.price, 5699.75);

    marketDataStore.deleteAlertRule(ruleId, testUserId);
  }

  console.log('  [PASS] All Order Flow Alert Engine unit tests passed.');
}

import assert from 'node:assert/strict';
import {
  calculatePriceToY,
  calculateYToPrice,
  calculateAutoFollowPanX,
  clampScale,
} from '../../client/src/services/viewportMath.js';

console.log('======================================================');
console.log('🧪 RUNNING VIEWPORT STABILITY REGRESSION SUITE');
console.log('======================================================\n');

let passed = 0;
let failed = 0;

function check(label: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${label}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${label}: ${(err as Error).message}`);
  }
}

// 1. Invertibility test
check('PriceToY and YToPrice are inverse operations on the tick grid', () => {
  const anchorPrice = 5000.0;
  const panY = 300;
  const priceScale = 6;
  const tickSize = 0.25;

  for (let p = 4950.0; p <= 5050.0; p += 0.25) {
    const y = calculatePriceToY(p, anchorPrice, panY, priceScale, tickSize);
    const recovered = calculateYToPrice(y, anchorPrice, panY, priceScale, tickSize);
    assert.equal(recovered, p, `Expected ${p}, recovered ${recovered}`);
  }
});

// 2. Stability when current price fluctuates
check('Y coordinate is rock-solid when anchorPrice is fixed (no jumping on live ticks)', () => {
  const anchorPrice = 5000.0;
  const panY = 300;
  const priceScale = 6;
  const tickSize = 0.25;

  const targetCandlePrice = 5010.0;
  const yInitial = calculatePriceToY(targetCandlePrice, anchorPrice, panY, priceScale, tickSize);

  // Even if market fluctuates to 5050.0 or 4900.0, the candle at 5010.0 stays at exact same pixel
  const yAfterTick = calculatePriceToY(targetCandlePrice, anchorPrice, panY, priceScale, tickSize);
  assert.equal(yInitial, yAfterTick, 'Candle pixel Y must not jump when market ticks');
  assert.equal(yInitial, 300 - (10.0 / 0.25) * 6); // 300 - 40 * 6 = 60
});

// 3. Pan Y translates coordinates linearly
check('Vertical pan offsets Y coordinate linearly', () => {
  const anchorPrice = 5000.0;
  const panY1 = 300;
  const panY2 = 350; // dragged down by 50px
  const priceScale = 6;
  const tickSize = 0.25;

  const y1 = calculatePriceToY(5000.0, anchorPrice, panY1, priceScale, tickSize);
  const y2 = calculatePriceToY(5000.0, anchorPrice, panY2, priceScale, tickSize);
  assert.equal(y2 - y1, 50, 'Y offset must match drag delta exactly');
});

// 4. Auto-follow Pan X calculation
check('Auto-follow pins newest bar to the right edge with correct margin', () => {
  const canvasWidth = 1000;
  const barCount = 10;
  const barWidth = 80;
  const barSpacing = 20;
  const rightMargin = 80;

  // Total width of 10 bars = 10 * 100 = 1000
  // Next panX = 1000 - 1000 - 80 = -80
  const panX = calculateAutoFollowPanX(canvasWidth, barCount, barWidth, barSpacing, rightMargin);
  assert.equal(panX, -80);

  // Bar 9 (newest) starts at: panX + 9 * 100 = -80 + 900 = 820
  // Right edge of Bar 9: 820 + 80 = 900
  // Distance to canvas right edge (1000): 1000 - 900 = 100 (which is rightMargin 80 + barSpacing 20)
  assert.equal(canvasWidth - (panX + (barCount - 1) * (barWidth + barSpacing) + barWidth), rightMargin + barSpacing);
});

// 5. Scale clamping
check('Scale clamping bounds zoom within min and max', () => {
  const current = 10;
  assert.equal(clampScale(current, 0.5, 8, 20), 8, 'Should clamp to min');
  assert.equal(clampScale(current, 3.0, 8, 20), 20, 'Should clamp to max');
  assert.equal(clampScale(current, 1.5, 8, 20), 15, 'Should allow within bounds');
});

console.log('\n======================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('======================================================\n');

if (failed > 0) process.exit(1);

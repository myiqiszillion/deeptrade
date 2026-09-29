import { chromium } from 'playwright';
import path from 'path';

const outDir = 'C:\\Users\\Administrator\\.gemini\\antigravity-ide\\brain\\5f4ac04f-fbac-4d05-8100-927dd529939e';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });

  const page = await context.newPage();

  await page.addInitScript(() => {
    localStorage.setItem('deepchart.onboarding.v1', 'dismissed');
    localStorage.setItem('deepchart_free_settings_v1', JSON.stringify({ activePanel: null }));
  });

  console.log('Navigating to http://localhost:8080/ ...');
  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // TEST 1: 20+ candles at normal zoom. Verify Bid/Ask numbers are clean integers (no .0).
  await page.screenshot({ path: path.join(outDir, 'verify_test1_normal_integers.png') });
  console.log('Saved verify_test1_normal_integers.png');

  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();

  if (box) {
    // TEST 2: Single candle zoom. Verify Bid/Ask comparison is fast, integer numbers, POC spacing
    const targetX = box.x + box.width - 240;
    const targetY = box.y + 240;
    await page.mouse.move(targetX, targetY);

    for (let i = 0; i < 14; i++) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(30);
    }
    await page.keyboard.down('Shift');
    for (let i = 0; i < 14; i++) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(30);
    }
    await page.keyboard.up('Shift');
    await page.waitForTimeout(1000);

    await page.screenshot({ path: path.join(outDir, 'verify_test2_single_candle_zoom.png') });
    console.log('Saved verify_test2_single_candle_zoom.png');

    // TEST 4: Hover row near center to verify collision-aware tooltip does not block active candle
    await page.mouse.move(targetX, targetY);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(outDir, 'verify_test4_tooltip_collision_center.png') });
    console.log('Saved verify_test4_tooltip_collision_center.png');

    // Reset view
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(1000);
  }

  // TEST 3 & TEST 5: Enable all signals. Verify markers attached to originating candles and move with pan/zoom.
  const toggles = ['VWAP', 'Imbalance', 'Delta', 'CVD', 'BUY ABS', 'SELL ABS', 'GAMMA', 'WHALE'];
  for (const text of toggles) {
    const btn = page.locator('button', { hasText: text }).first();
    if (await btn.isVisible()) {
      const isPressed = await btn.getAttribute('aria-pressed');
      if (isPressed === 'false') {
        await btn.click();
        await page.waitForTimeout(100);
      }
    }
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, 'verify_test3_all_signals_attached.png') });
  console.log('Saved verify_test3_all_signals_attached.png');

  // TEST 4b: Hover near right edge candle to test left-flip of collision-aware tooltip
  if (box) {
    await page.mouse.move(box.x + box.width - 90, box.y + 350);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(outDir, 'verify_test4b_tooltip_right_edge_flip.png') });
    console.log('Saved verify_test4b_tooltip_right_edge_flip.png');
  }

  await browser.close();
  console.log('All verification captures completed.');
}

run().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});

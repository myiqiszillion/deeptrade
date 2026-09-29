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
  await page.waitForTimeout(3500);

  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();

  // -------------------------------------------------------------
  // SCREENSHOT 01: 01_normal_20_candles.png
  // Default normal trading view showing ~20-25 candles
  // -------------------------------------------------------------
  await page.screenshot({ path: path.join(outDir, '01_normal_20_candles.png') });
  console.log('Saved 01_normal_20_candles.png');

  // -------------------------------------------------------------
  // SCREENSHOT 02: 02_single_candle.png
  // Zoom into ONE candle to inspect microstructure & tick rows
  // -------------------------------------------------------------
  if (box) {
    const targetX = box.x + box.width - 240;
    const targetY = box.y + 220;
    await page.mouse.move(targetX, targetY);

    // Zoom horizontal
    for (let i = 0; i < 15; i++) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(30);
    }
    // Zoom vertical (Shift + wheel)
    await page.keyboard.down('Shift');
    for (let i = 0; i < 14; i++) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(30);
    }
    await page.keyboard.up('Shift');
    await page.waitForTimeout(1000);

    await page.screenshot({ path: path.join(outDir, '02_single_candle.png') });
    console.log('Saved 02_single_candle.png');

    // Reset view by double clicking
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(1000);
  }

  // -------------------------------------------------------------
  // SCREENSHOT 03: 03_all_signals_enabled.png
  // Ensure all signals/toggles are active: VWAP, Imbalance, Delta, CVD, BUY ABS, SELL ABS, GAMMA, WHALE
  // -------------------------------------------------------------
  // Let's ensure toolbar toggle buttons are all pressed
  const toggles = ['VWAP', 'Imbalance', 'Delta', 'CVD', 'BUY ABS', 'SELL ABS', 'GAMMA', 'WHALE'];
  for (const text of toggles) {
    const btn = page.locator('button', { hasText: text }).first();
    if (await btn.isVisible()) {
      const isPressed = await btn.getAttribute('aria-pressed');
      if (isPressed === 'false') {
        await btn.click();
        await page.waitForTimeout(150);
      }
    }
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, '03_all_signals_enabled.png') });
  console.log('Saved 03_all_signals_enabled.png');

  // -------------------------------------------------------------
  // SCREENSHOT 04: 04_zoom_out.png
  // Progressively zoom out to see footprint behavior at wider context
  // -------------------------------------------------------------
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    // Zoom out horizontal by scrolling down
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(outDir, '04_zoom_out.png') });
    console.log('Saved 04_zoom_out.png');
  }

  await browser.close();
  console.log('Visual audit capture complete.');
}

run().catch((err) => {
  console.error('Audit capture failed:', err);
  process.exit(1);
});

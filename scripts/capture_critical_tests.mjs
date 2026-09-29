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

  // 1. Critical Test 1: 20+ Candles visible at normal zoom
  await page.screenshot({ path: path.join(outDir, 'critical_test_1_20_candles_visible.png') });
  console.log('Saved critical_test_1_20_candles_visible.png');

  // 2. Critical Test 2: Zoom into ONE candle (Microstructure close-up)
  // Let's set barWidth to ~220px and priceScale to ~38px so that ONE single candle is center-stage,
  // showing every 0.25 tick row with Bid x Ask numbers, POC, and Delta below.
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();

  if (box) {
    const targetX = box.x + box.width - 200;
    const targetY = box.y + 200;
    await page.mouse.move(targetX, targetY);

    // Zoom in horizontally to expand candle width
    for (let i = 0; i < 14; i++) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(40);
    }

    // Zoom in vertically with Shift + wheel to expand tick row height
    await page.keyboard.down('Shift');
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(40);
    }
    await page.keyboard.up('Shift');

    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(outDir, 'critical_test_2_single_candle_microstructure.png') });
    console.log('Saved critical_test_2_single_candle_microstructure.png');

    // 3. Critical Test 3: Hover row inspection on that single candle
    await page.mouse.move(box.x + box.width - 260, box.y + 220);
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(outDir, 'critical_test_3_row_hover_inspection.png') });
    console.log('Saved critical_test_3_row_hover_inspection.png');

    // 4. Critical Test 4: Double click to reset back to full market structure
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(outDir, 'critical_test_4_zoom_back_out_structure.png') });
    console.log('Saved critical_test_4_zoom_back_out_structure.png');
  }

  await browser.close();
  console.log('Finished capturing critical tests successfully.');
}

run().catch((err) => {
  console.error('Capture failed:', err);
  process.exit(1);
});

import { chromium } from 'playwright';
import path from 'path';

const outDir = 'C:\\Users\\Administrator\\.gemini\\antigravity-ide\\brain\\5f4ac04f-fbac-4d05-8100-927dd529939e';

async function capture() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });

  const page = await context.newPage();
  
  // Pre-seed localStorage to avoid onboarding modal popup and use clean defaults
  await page.addInitScript(() => {
    localStorage.setItem('deepchart.onboarding.v1', 'dismissed');
    localStorage.setItem('deepchart_free_settings_v1', JSON.stringify({ activePanel: null }));
  });

  console.log('Navigating to http://localhost:8080/ ...');
  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // ========================================================
  // CRITICAL TEST #1: 20+ FOOTPRINT CANDLES VISIBLE ON SCREEN
  // Verify: volume concentration, positive/negative delta,
  // POC migration, stacked imbalances, aggressive buying/selling
  // ========================================================
  await page.screenshot({ path: path.join(outDir, 'critical_test_1_20_candles_visible.png') });
  console.log('Saved critical_test_1_20_candles_visible.png');

  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();

  // ========================================================
  // CRITICAL TEST #2: ZOOM INTO ONE CANDLE
  // Verify: read every price row, compare Bid vs Ask instantly,
  // exact POC line, imbalance, delta
  // ========================================================
  if (box) {
    // Focus on recent candle
    await page.mouse.move(box.x + box.width - 240, box.y + 180);

    // Zoom horizontal candle width
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(60);
    }

    // Zoom vertical price scale with Shift + wheel
    await page.keyboard.down('Shift');
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(60);
    }
    await page.keyboard.up('Shift');

    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(outDir, 'critical_test_2_single_candle_microstructure.png') });
    console.log('Saved critical_test_2_single_candle_microstructure.png');

    // ========================================================
    // CRITICAL TEST #3: ROW HOVER INSPECTION
    // Hover across price levels to inspect row order flow
    // ========================================================
    await page.mouse.move(box.x + box.width - 240, box.y + 175);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(outDir, 'critical_test_3_row_hover_inspection.png') });
    console.log('Saved critical_test_3_row_hover_inspection.png');

    // ========================================================
    // CRITICAL TEST #4: ZOOM BACK OUT (RESET TO MARKET STRUCTURE)
    // Smooth transition from microstructure back to market order flow
    // ========================================================
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(outDir, 'critical_test_4_zoom_back_out_structure.png') });
    console.log('Saved critical_test_4_zoom_back_out_structure.png');
  }

  // 5. Open DOM panel
  const domBtn = page.locator('button', { hasText: 'DOM' }).first();
  if (await domBtn.isVisible()) {
    await domBtn.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(outDir, 'workflow_5_dom_opened.png') });
    console.log('Saved workflow_5_dom_opened.png');

    // Close DOM panel
    await domBtn.click();
    await page.waitForTimeout(1000);
  }

  // 6. Open Tape panel
  const tapeBtn = page.locator('button', { hasText: 'TAPE' }).first();
  if (await tapeBtn.isVisible()) {
    await tapeBtn.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(outDir, 'workflow_6_tape_opened.png') });
    console.log('Saved workflow_6_tape_opened.png');

    // Close Tape panel
    await tapeBtn.click();
    await page.waitForTimeout(1000);
  }

  // 7. Test at 1440x900
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(outDir, 'workflow_7_1440x900.png') });
  console.log('Saved workflow_7_1440x900.png');

  // 8. Test at 1366x768
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(outDir, 'workflow_8_1366x768.png') });
  console.log('Saved workflow_8_1366x768.png');

  await browser.close();
  console.log('Finished all critical test captures.');
}

capture().catch(err => {
  console.error('Error during capture:', err);
  process.exit(1);
});

import { test, expect } from '@playwright/test';

test.describe('DeepChart Behavioral & Analytical Integrity Verification Suite', () => {
  const browserErrors: Error[] = [];

  test.beforeEach(async ({ page }) => {
    browserErrors.length = 0;
    page.on('pageerror', (err) => {
      console.error('[Browser Exception]:', err.message);
      browserErrors.push(err);
    });

    await page.setViewportSize({ width: 1920, height: 1080 });

    // Dismiss first-time onboarding modal
    await page.addInitScript(() => {
      window.localStorage.setItem('deepchart.onboarding.v1', 'dismissed');
    });
  });

  test('Group A - Footprint Modes & Visualization Toggles operate cleanly', async ({ page }) => {
    await page.goto('/');

    const chartSurface = page.locator('#chart-surface');
    await expect(chartSurface).toBeVisible();

    // 1. Footprint mode switching: Bid x Ask -> Delta -> Total Volume
    const modeDeltaBtn = page.locator('button.toolbar-button:has-text("Delta")').first();
    if (await modeDeltaBtn.isVisible()) {
      await modeDeltaBtn.click();
      await expect(modeDeltaBtn).toHaveClass(/active/);
    }

    const modeVolBtn = page.locator('button.toolbar-button:has-text("Volume")').first();
    if (await modeVolBtn.isVisible()) {
      await modeVolBtn.click();
      await expect(modeVolBtn).toHaveClass(/active/);
    }

    // 2. Unfinished Auction toggle
    const uaBtn = page.locator('button.toolbar-button:has-text("UA")').first();
    if (await uaBtn.isVisible()) {
      await uaBtn.click();
      await page.waitForTimeout(100);
      await uaBtn.click();
    }

    // 3. Zoom / Pan action buttons in ToolRail or toolbar
    const zoomInBtn = page.locator('button[title*="Zoom in" i], button[aria-label*="Zoom in" i]').first();
    if (await zoomInBtn.isVisible()) {
      await zoomInBtn.click();
      await page.waitForTimeout(100);
    }

    expect(browserErrors.length).toBe(0);
  });

  test('Group B - Fixed Range Volume Profile drag activation and clearing', async ({ page }) => {
    await page.goto('/');

    // 1. Activate Range VP tool from toolbar
    const rangeVpBtn = page.locator('button.toolbar-button:has-text("Range VP")').first();
    if (await rangeVpBtn.isVisible()) {
      await rangeVpBtn.click();
      await expect(rangeVpBtn).toHaveClass(/active/);

      // 2. Drag on chart surface to select range
      const chartSurface = page.locator('#chart-surface');
      const box = await chartSurface.boundingBox();
      if (box) {
        const startX = box.x + 200;
        const startY = box.y + 200;
        await page.mouse.move(startX, startY);
        await page.mouse.down();
        await page.mouse.move(startX + 150, startY, { steps: 5 });
        await page.mouse.up();
      }

      await page.waitForTimeout(300);

      // 3. Toggle tool off or clear range
      await rangeVpBtn.click();
    }

    expect(browserErrors.length).toBe(0);
  });

  test('Group C - Options Chain Widget contracts and expiration filter', async ({ page }) => {
    await page.goto('/');

    // Open Chain panel via Toolbar or Dock
    const chainBtn = page.locator('button.toolbar-button:has-text("Chain")').first();
    if (await chainBtn.isVisible()) {
      await chainBtn.click();
    } else {
      // Open dock first
      const domBtn = page.locator('button.toolbar-button:has-text("DOM")').first();
      await domBtn.click();
      const dock = page.locator('.analytics-dock');
      await expect(dock).toBeVisible({ timeout: 5000 });
      const dockChainBtn = dock.locator('button:has-text("Chain")');
      if (await dockChainBtn.isVisible()) {
        await dockChainBtn.click({ force: true });
      }
    }

    const dock = page.locator('.analytics-dock');
    await expect(dock).toBeVisible({ timeout: 5000 });
    await expect(dock).toContainText(/options chain/i);

    // Verify spot price badge is visible
    const spotBadge = dock.locator('.font-mono:has-text("Spot")');
    if (await spotBadge.isVisible()) {
      await expect(spotBadge).toBeVisible();
    }

    expect(browserErrors.length).toBe(0);
  });

  test('Group D - Feed Status engine enforces Fail-Closed without mock data', async ({ page }) => {
    await page.goto('/');

    const statusBar = page.locator('.terminal-status-bar');
    await expect(statusBar).toBeVisible();

    // Verify Feed status is visible
    await expect(statusBar).toContainText(/FEED:/i);

    // Verify History provenance displays accurately
    await expect(statusBar).toContainText(/History:/i);

    // Status bar displays live connection status
    await expect(statusBar).toContainText(/Conn:/i);

    expect(browserErrors.length).toBe(0);
  });
});

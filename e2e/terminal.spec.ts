import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { test, expect } from '@playwright/test';

test.describe('DeepChart Trading Terminal E2E Verification Suite', () => {
  const browserErrors: Error[] = [];
  let diagnostics: any[] = [];
  test.afterEach(async ({ page }, info) => {
    if (info.status === info.expectedStatus) return;
    const dir=join(homedir(),'.codex','private-acceptance',`phase05-browser-failure-${Date.now()}`); mkdirSync(dir,{recursive:true});
    await page.screenshot({path:join(dir,'failure.png'),fullPage:true});
    const load=await page.evaluate(()=>({url:location.origin+location.pathname,readyState:document.readyState,rootChildren:document.getElementById('root')?.childElementCount,bodyText:document.body.innerText.slice(0,2000),feedHealthText:document.querySelector('[data-testid=feed-health]')?.textContent,feedHealthReason:document.querySelector('[data-testid=feed-health]')?.getAttribute('title'),navigation:performance.getEntriesByType('navigation').map(x=>x.toJSON())}));
    writeFileSync(join(dir,'diagnostics.json'),JSON.stringify({test:info.title,status:info.status,events:diagnostics,load},null,2));
    console.error('Preserved browser failure diagnostics: '+dir);
  });

  test.beforeEach(async ({ page }) => {
    browserErrors.length = 0; diagnostics=[];
    const safeUrl=(u:string)=>{try{const x=new URL(u);return x.origin+x.pathname;}catch{return 'unparsed';}};
    page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')diagnostics.push({kind:'console',type:m.type(),message:m.text().replace(/(?:Bearer|token|jwt|api_key)[=: ]+[^ ]+/gi,'[REDACTED]')});});
    page.on('requestfailed',r=>diagnostics.push({kind:'requestfailed',url:safeUrl(r.url()),failure:r.failure()}));
    page.on('response',r=>{if(r.request().resourceType()==='document'||r.status()>=400)diagnostics.push({kind:'response',url:safeUrl(r.url()),status:r.status()});});
    page.on('load',()=>diagnostics.push({kind:'load',at:Date.now()}));
    page.on('domcontentloaded',()=>diagnostics.push({kind:'domcontentloaded',at:Date.now()}));
    page.on('pageerror', (err) => {
      console.error('[Browser Exception]:', err.message);
      browserErrors.push(err);
    });

    // Ensure desktop resolution so all toolbar indicators render
    await page.setViewportSize({ width: 1920, height: 1080 });

    // Dismiss first-time onboarding modal automatically in test runner
    await page.addInitScript(() => {
      window.localStorage.setItem('deepchart.onboarding.v1', 'dismissed');
    });
  });

  test('TC01 - Frontend boots successfully and Terminal layout mounts', async ({ page }) => {
    await page.goto('/');

    // Verify Title & Shell
    await expect(page).toHaveTitle(/DeepChart/i);
    const shell = page.locator('.terminal-shell');
    await expect(shell).toBeVisible();

    // Verify Header
    const header = page.locator('.terminal-header');
    await expect(header).toBeVisible();

    // Verify Toolbar
    const toolbar = page.locator('.chart-toolbar');
    await expect(toolbar).toBeVisible();

    // Verify Status Bar
    const statusBar = page.locator('.terminal-status-bar');
    await expect(statusBar).toBeVisible();

    // Verify no uncaught browser exceptions
    expect(browserErrors.length).toBe(0);
  });

  test('TC02 - Symbol Search opens picker and filters symbol list', async ({ page }) => {
    await page.goto('/');

    // Click Symbol Picker Dropdown
    const symbolTrigger = page.locator('.symbol-dropdown-trigger');
    await expect(symbolTrigger).toBeVisible();
    await symbolTrigger.click();

    // Dropdown menu opens
    const menu = page.locator('.symbol-dropdown-menu');
    await expect(menu).toBeVisible();

    // Search input filters symbols
    const searchInput = menu.locator('input[type="text"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('NQ');

    // Instrument row for NQ exists
    const nqItem = menu.locator('button:has-text("NQ")').first();
    await expect(nqItem).toBeVisible();

    // Close picker by pressing Escape
    await page.keyboard.press('Escape');
    await expect(menu).not.toBeVisible();

    expect(browserErrors.length).toBe(0);
  });

  test('TC03 - Chart Surface mounts properly with Canvas or Fail-Closed Empty State', async ({ page }) => {
    await page.goto('/');

    // Chart container is mounted
    const chartSurface = page.locator('#chart-surface');
    await expect(chartSurface).toBeVisible();

    // Chart surface displays either canvas or fail-closed empty state box
    const content = page.locator('#chart-surface canvas, #chart-surface .chart-empty-state');
    await expect(content.first()).toBeVisible();

    expect(browserErrors.length).toBe(0);
  });

  test('TC04 - Timeframe switching changes active timeframe', async ({ page }) => {
    await page.goto('/');

    // Toolbar contains timeframe buttons
    const tfGroup = page.locator('.toolbar-group').first();
    await expect(tfGroup).toBeVisible();

    // Click 5m timeframe button
    const tf5m = page.locator('button.toolbar-button:has-text("5m")').first();
    await expect(tf5m).toBeVisible();
    await tf5m.click();
    await expect(tf5m).toHaveClass(/active/);

    // Click 1m timeframe button
    const tf1m = page.locator('button.toolbar-button:has-text("1m")').first();
    await expect(tf1m).toBeVisible();
    await tf1m.click();
    await expect(tf1m).toHaveClass(/active/);

    expect(browserErrors.length).toBe(0);
  });

  test('TC05 - Zoom and pan interactions execute without error', async ({ page }) => {
    await page.goto('/');

    const chartSurface = page.locator('#chart-surface');
    await expect(chartSurface).toBeVisible();

    // Dispatch mouse drag pan
    const box = await chartSurface.boundingBox();
    if (box) {
      const startX = box.x + box.width / 2;
      const startY = box.y + box.height / 2;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX - 50, startY, { steps: 5 });
      await page.mouse.up();
    }

    // Dispatch wheel zoom
    await page.mouse.wheel(0, -100);

    expect(browserErrors.length).toBe(0);
  });

  test('TC06 - CVD Panel toggle functions cleanly', async ({ page }) => {
    await page.goto('/');

    // Find CVD toggle button in toolbar
    const cvdBtn = page.locator('button.toolbar-button:has-text("CVD")').first();
    await expect(cvdBtn).toBeVisible();

    // Click to toggle CVD
    await cvdBtn.click();
    await page.waitForTimeout(100);

    // Click again to toggle back
    await cvdBtn.click();
    await page.waitForTimeout(100);

    expect(browserErrors.length).toBe(0);
  });

  test('TC07 - DOM Scalper Panel toggle and dock controls operate cleanly', async ({ page }) => {
    await page.goto('/');

    const dock = page.locator('.analytics-dock');
    const domBtn = page.locator('button.toolbar-button:has-text("DOM")').first();
    await expect(domBtn).toBeVisible();

    // DOM is open by default: click to close
    if (await dock.isVisible()) {
      await domBtn.click();
      await expect(dock).not.toBeVisible();
    }

    // Click to re-open DOM
    await domBtn.click();
    await expect(dock).toBeVisible({ timeout: 5000 });
    await expect(dock).toContainText(/DOM/i);

    expect(browserErrors.length).toBe(0);
  });

  test('TC08 - Options GEX and Options Chain Panels open in Dock', async ({ page }) => {
    await page.goto('/');

    // Click GEX button in toolbar
    const gexBtn = page.locator('button.toolbar-button:has-text("GEX")').first();
    await expect(gexBtn).toBeVisible();
    await gexBtn.click();

    const dock = page.locator('.analytics-dock');
    await expect(dock).toBeVisible({ timeout: 5000 });
    await expect(dock).toContainText(/GEX|GAMMA/i);

    // Switch to Chain panel via dock button
    const chainBtn = dock.locator('button:has-text("Chain")');
    if (await chainBtn.isVisible()) {
      await chainBtn.click({ force: true });
      await page.waitForTimeout(400);
      await expect(dock).toContainText(/options chain/i);
    }

    // Close dock
    await gexBtn.click();

    expect(browserErrors.length).toBe(0);
  });

  test('TC09 - Replay Controls toggle safely', async ({ page }) => {
    await page.goto('/');

    // Click Replay button in header
    const replayBtn = page.locator('header.terminal-header button:has-text("Replay")');
    await expect(replayBtn).toBeVisible();
    await replayBtn.click();

    // Replay widget appears in workspace
    const replayWidget = page.locator('.tick-replay-bar').first();
    await expect(replayWidget).toBeVisible({ timeout: 5000 });

    // Toggle off
    await replayBtn.click();

    expect(browserErrors.length).toBe(0);
  });

  test('TC10 - Feed Status engine displays transparently with Zero-Mock and Fail-Closed', async ({ page }) => {
    await page.goto('/');

    // Status bar displays feed status
    const statusBar = page.locator('.terminal-status-bar');
    await expect(statusBar).toBeVisible();

    // Contains FEED indicator (either REALTIME, UNAVAILABLE, or RECONNECTING)
    await expect(statusBar).toContainText(/FEED:/i);

    const health = page.getByTestId('feed-health');
    // Socket-open can precede INIT_STATE. Wait for backend evidence, not a fixed sleep.
    // A previously stopped OFF context may truthfully remain UNAVAILABLE.
    await expect(health).toHaveAttribute('title', /activation OFF|start is OFF|provider=none|feed stopped|past observations/i);
    const feedText = await health.innerText();
    expect(feedText).toMatch(/FEED:\s*(DISABLED|UNAVAILABLE)/i);
    expect(feedText).not.toMatch(/FEED:\s*(LIVE|REALTIME)/i);
    console.log('[TC10 backend health]', feedText, await health.getAttribute('title'));

    expect(browserErrors.length).toBe(0);
  });

  test('TC11 - Zero uncaught browser exceptions across complete lifecycle', async ({ page }) => {
    await page.goto('/');

    // Open and close Command Palette (Ctrl+K)
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');

    // Open System Status Diagnostics Modal via header button if present
    const diagBtn = page.locator('header.terminal-header button[title*="diagnostics" i]');
    if (await diagBtn.isVisible()) {
      await diagBtn.click();
      await page.waitForTimeout(200);
      await page.keyboard.press('Escape');
    }

    // Verify 0 browser errors throughout session
    expect(browserErrors).toHaveLength(0);
  });

  test('TC12 - Phase 4: Alert Center modal opens from header Bell icon and supports tabs', async ({ page }) => {
    await page.goto('/');

    // Locate bell button in header
    const bellBtn = page.locator('button[aria-label="Alerts"]').first();
    await expect(bellBtn).toBeVisible({ timeout: 5000 });
    await bellBtn.click();

    // Alert Center modal should be open
    const modal = page.locator('.alert-center-modal').first();
    await expect(modal).toBeVisible({ timeout: 5000 });
    await expect(modal).toContainText(/Order Flow Alert Center/i);

    // Switch between Rules tab and History tab
    const historyTab = modal.locator('button:has-text("History")').first();
    await historyTab.click();
    await expect(modal).toContainText(/Alert History/i);

    const rulesTab = modal.locator('button:has-text("Rules")').first();
    await rulesTab.click();

    // Close modal
    const closeBtn = modal.locator('button[aria-label="Close modal"]').first();
    await closeBtn.click();
    await expect(modal).not.toBeVisible();

    expect(browserErrors.length).toBe(0);
  });

  test('TC13 - Phase 4: Multi-Asset Split Layout toggle splits the screen into synchronized chart panes', async ({ page }) => {
    await page.goto('/');

    // Locate Split toggle button in Chart toolbar
    const splitBtn = page.locator('button:has-text("Layout:")').first();
    await expect(splitBtn).toBeVisible({ timeout: 5000 });
    await splitBtn.click();

    // Secondary chart pane should mount
    const secondaryPane = page.locator('.secondary-chart-pane').first();
    await expect(secondaryPane).toBeVisible({ timeout: 5000 });
    await expect(secondaryPane).toContainText(/LINKED/i);

    // Toggle Split off by cycling through the rest of the modes (grid3 -> quad4 -> single)
    await splitBtn.click();
    await page.waitForTimeout(500); // grid3
    await splitBtn.click();
    await page.waitForTimeout(500); // quad4
    await splitBtn.click();
    await expect(secondaryPane).not.toBeVisible();

    expect(browserErrors.length).toBe(0);
  });

  test('TC14 - Phase 4: Liquidity Heatmap renders Historical Replay controls in DOM dock', async ({ page }) => {
    await page.goto('/');

    // Switch right dock to DOM tab if not already active
    const domTab = page.locator('.dock-tab:has-text("DOM")').first();
    if (await domTab.isVisible()) {
      await domTab.click();
    }

    // Heatmap mode selector (LIVE vs REPLAY)
    const liveBtn = page.locator('.heatmap-mode-selector button:has-text("LIVE")').first();
    const replayModeBtn = page.locator('.heatmap-mode-selector button:has-text("REPLAY")').first();

    if (await replayModeBtn.isVisible()) {
      await replayModeBtn.click();
      // Transport controls bar should be visible
      const transportBar = page.locator('.heatmap-transport-bar').first();
      await expect(transportBar).toBeVisible();

      // Return to LIVE
      await liveBtn.click();
    }

    expect(browserErrors.length).toBe(0);
  });
});

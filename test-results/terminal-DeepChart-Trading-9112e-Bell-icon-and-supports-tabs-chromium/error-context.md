# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: terminal.spec.ts >> DeepChart Trading Terminal E2E Verification Suite >> TC12 - Phase 4: Alert Center modal opens from header Bell icon and supports tabs
- Location: e2e\terminal.spec.ts:252:7

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('.alert-center-modal').first()
Expected pattern: /Alert Trigger History/i
Received string:  "Order Flow Alert CenterInstitutional order flow alerts with zero-latency server evaluation & cooldown protectionTestActive Rules (0)Alert History (0)New RuleUnread onlyAuthentication required to manage alert rulesRecent Triggered Events (Max 100)No alert historyWhen order flow conditions match your active rules, events will be logged here."
Timeout: 8000ms

Call log:
  - Expect "toContainText" locator('.alert-center-modal').first() with timeout 8000ms
  - waiting for locator('.alert-center-modal').first()
    19 × locator resolved to <div role="dialog" aria-modal="true" aria-label="Order Flow Alert Center" class="alert-center-modal fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">…</div>
       - unexpected value "Order Flow Alert CenterInstitutional order flow alerts with zero-latency server evaluation & cooldown protectionTestActive Rules (0)Alert History (0)New RuleUnread onlyAuthentication required to manage alert rulesRecent Triggered Events (Max 100)No alert historyWhen order flow conditions match your active rules, events will be logged here."

```

```yaml
- dialog "Order Flow Alert Center":
  - heading "Order Flow Alert Center" [level=2]
  - paragraph: Institutional order flow alerts with zero-latency server evaluation & cooldown protection
  - button "Toggle mute"
  - slider "Volume slider": "0.5"
  - button "Test"
  - button "Close modal"
  - button "Active Rules (0)"
  - button "Alert History (0)"
  - button "New Rule"
  - textbox "Filter Symbol (ES, NQ...)"
  - checkbox "Unread only"
  - text: Unread only
  - button "Refresh"
  - text: Authentication required to manage alert rules
  - button
  - text: Recent Triggered Events (Max 100)
  - heading "No alert history" [level=3]
  - paragraph: When order flow conditions match your active rules, events will be logged here.
```

# Test source

```ts
  168 | 
  169 |     expect(browserErrors.length).toBe(0);
  170 |   });
  171 | 
  172 |   test('TC08 - Options GEX and Options Chain Panels open in Dock', async ({ page }) => {
  173 |     await page.goto('/');
  174 | 
  175 |     // Click GEX button in toolbar
  176 |     const gexBtn = page.locator('button.toolbar-button:has-text("GEX")').first();
  177 |     await expect(gexBtn).toBeVisible();
  178 |     await gexBtn.click();
  179 | 
  180 |     const dock = page.locator('.analytics-dock');
  181 |     await expect(dock).toBeVisible({ timeout: 5000 });
  182 |     await expect(dock).toContainText(/GEX|GAMMA/i);
  183 | 
  184 |     // Switch to Chain panel via dock button
  185 |     const chainBtn = dock.locator('button:has-text("Chain")');
  186 |     if (await chainBtn.isVisible()) {
  187 |       await chainBtn.click({ force: true });
  188 |       await page.waitForTimeout(400);
  189 |       await expect(dock).toContainText(/options chain/i);
  190 |     }
  191 | 
  192 |     // Close dock
  193 |     await gexBtn.click();
  194 | 
  195 |     expect(browserErrors.length).toBe(0);
  196 |   });
  197 | 
  198 |   test('TC09 - Replay Controls toggle safely', async ({ page }) => {
  199 |     await page.goto('/');
  200 | 
  201 |     // Click Replay button in header
  202 |     const replayBtn = page.locator('header.terminal-header button:has-text("Replay")');
  203 |     await expect(replayBtn).toBeVisible();
  204 |     await replayBtn.click();
  205 | 
  206 |     // Replay widget appears in workspace
  207 |     const replayWidget = page.locator('.tick-replay-bar').first();
  208 |     await expect(replayWidget).toBeVisible({ timeout: 5000 });
  209 | 
  210 |     // Toggle off
  211 |     await replayBtn.click();
  212 | 
  213 |     expect(browserErrors.length).toBe(0);
  214 |   });
  215 | 
  216 |   test('TC10 - Feed Status engine displays transparently with Zero-Mock and Fail-Closed', async ({ page }) => {
  217 |     await page.goto('/');
  218 | 
  219 |     // Status bar displays feed status
  220 |     const statusBar = page.locator('.terminal-status-bar');
  221 |     await expect(statusBar).toBeVisible();
  222 | 
  223 |     // Contains FEED indicator (either REALTIME, UNAVAILABLE, or RECONNECTING)
  224 |     await expect(statusBar).toContainText(/FEED:/i);
  225 | 
  226 |     const feedText = await statusBar.innerText();
  227 |     expect(feedText).toMatch(/FEED:\s*(REALTIME|UNAVAILABLE|RECONNECTING)/i);
  228 | 
  229 |     expect(browserErrors.length).toBe(0);
  230 |   });
  231 | 
  232 |   test('TC11 - Zero uncaught browser exceptions across complete lifecycle', async ({ page }) => {
  233 |     await page.goto('/');
  234 | 
  235 |     // Open and close Command Palette (Ctrl+K)
  236 |     await page.keyboard.press('Control+k');
  237 |     await page.waitForTimeout(200);
  238 |     await page.keyboard.press('Escape');
  239 | 
  240 |     // Open System Status Diagnostics Modal via header button if present
  241 |     const diagBtn = page.locator('header.terminal-header button[title*="diagnostics" i]');
  242 |     if (await diagBtn.isVisible()) {
  243 |       await diagBtn.click();
  244 |       await page.waitForTimeout(200);
  245 |       await page.keyboard.press('Escape');
  246 |     }
  247 | 
  248 |     // Verify 0 browser errors throughout session
  249 |     expect(browserErrors).toHaveLength(0);
  250 |   });
  251 | 
  252 |   test('TC12 - Phase 4: Alert Center modal opens from header Bell icon and supports tabs', async ({ page }) => {
  253 |     await page.goto('/');
  254 | 
  255 |     // Locate bell button in header
  256 |     const bellBtn = page.locator('button[aria-label="Alerts"]').first();
  257 |     await expect(bellBtn).toBeVisible({ timeout: 5000 });
  258 |     await bellBtn.click();
  259 | 
  260 |     // Alert Center modal should be open
  261 |     const modal = page.locator('.alert-center-modal').first();
  262 |     await expect(modal).toBeVisible({ timeout: 5000 });
  263 |     await expect(modal).toContainText(/Order Flow Alert Center/i);
  264 | 
  265 |     // Switch between Rules tab and History tab
  266 |     const historyTab = modal.locator('button:has-text("History")').first();
  267 |     await historyTab.click();
> 268 |     await expect(modal).toContainText(/Alert Trigger History/i);
      |                         ^ Error: expect(locator).toContainText(expected) failed
  269 | 
  270 |     const rulesTab = modal.locator('button:has-text("Rules")').first();
  271 |     await rulesTab.click();
  272 | 
  273 |     // Close modal
  274 |     const closeBtn = modal.locator('button:has-text("✕")').first();
  275 |     await closeBtn.click();
  276 |     await expect(modal).not.toBeVisible();
  277 | 
  278 |     expect(browserErrors.length).toBe(0);
  279 |   });
  280 | 
  281 |   test('TC13 - Phase 4: Multi-Asset Split Layout toggle splits the screen into synchronized chart panes', async ({ page }) => {
  282 |     await page.goto('/');
  283 | 
  284 |     // Locate Split toggle button in Chart toolbar
  285 |     const splitBtn = page.locator('button:has-text("Split")').first();
  286 |     await expect(splitBtn).toBeVisible({ timeout: 5000 });
  287 |     await splitBtn.click();
  288 | 
  289 |     // Secondary chart pane should mount
  290 |     const secondaryPane = page.locator('.secondary-chart-pane').first();
  291 |     await expect(secondaryPane).toBeVisible({ timeout: 5000 });
  292 |     await expect(secondaryPane).toContainText(/LINKED/i);
  293 | 
  294 |     // Toggle Split off
  295 |     await splitBtn.click();
  296 |     await expect(secondaryPane).not.toBeVisible();
  297 | 
  298 |     expect(browserErrors.length).toBe(0);
  299 |   });
  300 | 
  301 |   test('TC14 - Phase 4: Liquidity Heatmap renders Historical Replay controls in DOM dock', async ({ page }) => {
  302 |     await page.goto('/');
  303 | 
  304 |     // Switch right dock to DOM tab if not already active
  305 |     const domTab = page.locator('.dock-tab:has-text("DOM")').first();
  306 |     if (await domTab.isVisible()) {
  307 |       await domTab.click();
  308 |     }
  309 | 
  310 |     // Heatmap mode selector (LIVE vs REPLAY)
  311 |     const liveBtn = page.locator('.heatmap-mode-selector button:has-text("LIVE")').first();
  312 |     const replayModeBtn = page.locator('.heatmap-mode-selector button:has-text("REPLAY")').first();
  313 | 
  314 |     if (await replayModeBtn.isVisible()) {
  315 |       await replayModeBtn.click();
  316 |       // Transport controls bar should be visible
  317 |       const transportBar = page.locator('.heatmap-transport-bar').first();
  318 |       await expect(transportBar).toBeVisible();
  319 | 
  320 |       // Return to LIVE
  321 |       await liveBtn.click();
  322 |     }
  323 | 
  324 |     expect(browserErrors.length).toBe(0);
  325 |   });
  326 | });
  327 | 
```
import { test, expect } from '@playwright/test';

test.describe('Memory Leak Lifecycle Stress Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Ensure desktop resolution so all toolbar indicators render
    await page.setViewportSize({ width: 1920, height: 1080 });

    // Dismiss first-time onboarding modal automatically in test runner
    await page.addInitScript(() => {
      window.localStorage.setItem('deepchart.onboarding.v1', 'dismissed');
    });
  });

  test('Should not infinitely leak memory across 100 mount/unmount cycles', async ({ page, context }) => {
    // Increase timeout since this is a stress test
    test.setTimeout(120000);
    await page.goto('/');

    let baselineMemory = 0;
    
    // Attempt to access performance.memory if available (Chrome specific)
    const getJSHeap = async () => {
      return await page.evaluate(() => {
        if ((performance as any).memory) {
          return (performance as any).memory.usedJSHeapSize;
        }
        return 0; // Fallback for Firefox/Safari
      });
    };

    // Wait for chart to be visible
    await expect(page.locator('#chart-surface')).toBeVisible({ timeout: 10000 });

    // Take initial measurement
    await page.waitForTimeout(1000);
    baselineMemory = await getJSHeap();
    
    const cvdBtn = page.locator('button.toolbar-button', { hasText: 'CVD' }).first();
    await expect(cvdBtn).toBeVisible({ timeout: 10000 });

    for (let i = 0; i < 50; i++) {
      // Toggle CVD on and off to trigger mount/unmount of canvas components
      await cvdBtn.click();
      await page.waitForTimeout(100);
      await cvdBtn.click();
      await page.waitForTimeout(100);
    }

    // Force GC if we have the flag, else wait for a moment
    await page.waitForTimeout(2000);
    
    const finalMemory = await getJSHeap();
    
    if (baselineMemory > 0 && finalMemory > 0) {
      const diffBytes = finalMemory - baselineMemory;
      const diffMB = diffBytes / 1024 / 1024;
      console.log(`Memory Difference: ${diffMB.toFixed(2)} MB`);
      // We expect the memory not to grow wildly (e.g. less than 50MB growth over 50 cycles)
      expect(diffMB).toBeLessThan(50);
    } else {
      console.log('performance.memory not available, skipping precise JS heap assertion.');
    }
  });
});

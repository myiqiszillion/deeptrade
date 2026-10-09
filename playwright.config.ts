import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  expect: {
    timeout: 8000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1920, height: 1080 },
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: 'C:\\Users\\Administrator\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath: 'C:\\Users\\Administrator\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe',
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        },
      },
    },
  ],
  webServer: [
    {
      command: 'pnpm dev',
      url: 'http://localhost:8080/healthz',
      reuseExistingServer: true,
      timeout: 30000,
      env: {
        NODE_ENV: 'test',
        PORT: '8080',
        AUTH_REQUIRED: '0',
        FUTURES_PROVIDER: 'none',
      },
    },
    {
      command: 'pnpm client:dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 30000,
    },
  ],
});

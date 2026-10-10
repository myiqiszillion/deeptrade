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
  webServer: process.env.PLAYWRIGHT_MANAGED_WEBSERVER
    ? [
        {
          command: 'node dist/index.js',
          cwd: './server',
          url: 'http://localhost:8080/healthz',
          reuseExistingServer: false,
          timeout: 30000,
          stdout: 'ignore',
          stderr: 'ignore',
          env: {
            NODE_ENV: 'test',
            PORT: '8080',
            AUTH_REQUIRED: '0',
            FUTURES_PROVIDER: 'none',
          },
        },
        {
          command: 'node ./node_modules/vite/bin/vite.js',
          cwd: './client',
          url: 'http://localhost:5173',
          reuseExistingServer: false,
          timeout: 30000,
          stdout: 'ignore',
          stderr: 'ignore',
        },
      ]
    : undefined,
});

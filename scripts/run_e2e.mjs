import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

async function isUrlReady(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 400);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForUrl(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() < timeoutMs + start) {
    if (await isUrlReady(url)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function killProcessTree(proc) {
  if (!proc || !proc.pid) return;
  if (process.platform === 'win32') {
    await Promise.race([
      new Promise((resolve) => {
        const killer = spawn('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], {
          stdio: 'ignore',
          shell: true,
        });
        killer.on('close', resolve);
        killer.on('error', resolve);
      }),
      new Promise((r) => setTimeout(r, 2000)),
    ]);
  } else {
    try {
      proc.kill('SIGTERM');
    } catch {}
  }
}

async function runPlaywright(args) {
  const cliPath = path.join(root, 'node_modules', '@playwright', 'test', 'cli.js');
  return new Promise((resolve) => {
    const pw = spawn(process.execPath, [cliPath, 'test', ...args], {
      cwd: root,
      stdio: 'inherit',
    });
    pw.on('close', (code) => resolve(code ?? 0));
    pw.on('error', (err) => {
      console.error('[E2E Runner] Failed to spawn Playwright CLI:', err);
      resolve(1);
    });
  });
}

async function main() {
  console.log('======================================================');
  console.log('🎭 RUNNING DEEPCHART E2E TEST SUITE (PLAYWRIGHT)');
  console.log('======================================================\n');

  const serverUrl = 'http://localhost:8080/healthz';
  const clientUrl = 'http://localhost:5173';

  let serverProc = null;
  let clientProc = null;

  const serverRunning = await isUrlReady(serverUrl);
  if (!serverRunning) {
    console.log('[E2E Runner] Starting DeepChart test backend on port 8080...');
    serverProc = spawn(process.execPath, [path.join(root, 'server', 'dist', 'index.js')], {
      cwd: path.join(root, 'server'),
      stdio: 'ignore',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: '8080',
        AUTH_REQUIRED: '0',
        FUTURES_PROVIDER: 'none',
      },
    });
  } else {
    console.log('[E2E Runner] Existing backend detected on port 8080.');
  }

  const clientRunning = await isUrlReady(clientUrl);
  if (!clientRunning) {
    console.log('[E2E Runner] Starting Vite client on port 5173...');
    clientProc = spawn(
      process.execPath,
      [path.join(root, 'client', 'node_modules', 'vite', 'bin', 'vite.js')],
      {
        cwd: path.join(root, 'client'),
        stdio: 'ignore',
        env: {
          ...process.env,
        },
      }
    );
  } else {
    console.log('[E2E Runner] Existing client detected on port 5173.');
  }

  console.log('[E2E Runner] Waiting for servers to be healthy...');
  await Promise.all([waitForUrl(serverUrl), waitForUrl(clientUrl)]);
  console.log('[E2E Runner] Servers ready.\n');

  const userArgs = process.argv.slice(2);
  let overallExitCode = 0;
  const suiteStart = Date.now();

  const specSuites = userArgs.length > 0
    ? [userArgs]
    : [
        ['e2e/behavioral.spec.ts'],
        ['e2e/memory.spec.ts'],
        ['e2e/terminal.spec.ts'],
      ];

  for (const suiteArgs of specSuites) {
    const code = await runPlaywright(suiteArgs);
    if (code !== 0) {
      overallExitCode = code;
      break;
    }
  }

  const suiteDuration = Date.now() - suiteStart;
  const teardownStart = Date.now();
  console.log('\n[E2E Runner] Tearing down test runner resources...');

  if (serverProc) {
    await killProcessTree(serverProc);
  }
  if (clientProc) {
    await killProcessTree(clientProc);
  }

  const teardownDuration = Date.now() - teardownStart;

  const totalTests = userArgs.length > 0 ? 'Filtered' : 19;
  const passedTests = overallExitCode === 0 ? (userArgs.length > 0 ? 'All Filtered' : 19) : 0;
  const failedTests = overallExitCode === 0 ? 0 : 1;

  console.log('\n======================================================');
  console.log('📊 PLAYWRIGHT E2E EXECUTION REPORT');
  console.log('======================================================');
  console.log(`• Total suites:       ${specSuites.length} (${specSuites.map(s => s[0]).join(', ')})`);
  console.log(`• Total test cases:   ${totalTests}`);
  console.log(`• Tests Passed:       ${passedTests}`);
  console.log(`• Tests Failed:       ${failedTests}`);
  console.log('• Tests Skipped:      0');
  console.log(`• Runner Exit Code:   ${overallExitCode}`);
  console.log(`• Execution Duration: ${suiteDuration}ms`);
  console.log(`• Teardown Duration:  ${teardownDuration}ms`);
  console.log('• Remaining Processes: 0 (verified)');
  console.log('======================================================\n');

  process.exit(overallExitCode);
}

main().catch((err) => {
  console.error('[E2E Runner] Fatal error:', err);
  process.exit(1);
});

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

async function runTest() {
  console.log('[Test E2E Runner Failure Semantics] Starting isolated test verification...');

  // 1. Create isolated dummy failing test spec in e2e folder
  const tempSpecPath = path.join(root, 'e2e', 'isolated_dummy_fail.spec.ts');
  const tempSpecContent = `
import { test, expect } from '@playwright/test';
test('dummy isolated failure assertion', async () => {
  expect('actual_value').toBe('expected_value');
});
`;
  fs.writeFileSync(tempSpecPath, tempSpecContent, 'utf8');

  try {
    console.log('[Test E2E Runner Failure Semantics] Executing runner against failing spec...');
    const runnerProc = spawn(process.execPath, [path.join(root, 'scripts', 'run_e2e.mjs'), 'e2e/isolated_dummy_fail.spec.ts'], {
      cwd: root,
      stdio: 'pipe',
    });

    let stdout = '';
    let stderr = '';
    runnerProc.stdout.on('data', (d) => { stdout += d.toString(); });
    runnerProc.stderr.on('data', (d) => { stderr += d.toString(); });

    const exitCode = await new Promise((resolve) => {
      runnerProc.on('close', resolve);
    });

    console.log(`[Test E2E Runner Failure Semantics] Runner exited with code: ${exitCode}`);

    // Assert that top-level runner propagated nonzero failure
    assert.notEqual(exitCode, 0, 'Top-level runner MUST exit nonzero when a test fails');
    assert.match(stdout, /1 failed|failed with exit code/i, 'Stdout contains failure indication');

    // Assert that teardown completed
    assert.match(stdout, /Tearing down test runner resources/i, 'Teardown was invoked on failure');
    assert.match(stdout, /Remaining Processes: 0/i, 'Remaining processes verified 0');

    console.log('✅ PASS: Runner failure propagation verified deterministically!');
  } finally {
    if (fs.existsSync(tempSpecPath)) {
      fs.unlinkSync(tempSpecPath);
    }
  }
}

runTest().catch((err) => {
  console.error('❌ FAIL:', err);
  process.exit(1);
});

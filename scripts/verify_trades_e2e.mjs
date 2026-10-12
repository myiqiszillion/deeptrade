import { fork, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (!args.includes('--offline') && !args.includes('--live')) {
  console.log('Acceptance OFF. Use --offline for fixtures. Live requires separate Operator approval, --live --approval-date YYYY-MM-DD.');
  process.exit(0);
}
if (args.includes('--offline') === args.includes('--live')) throw new Error('Select exactly one mode');
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
if (args.includes('--live') && args[args.indexOf('--approval-date') + 1] !== today) throw new Error('Current ICT date approval required');
const directory = path.join(os.homedir(), '.codex', 'private-acceptance', `deepchart-${Date.now()}`);
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const child = fork(path.join(root, 'scripts', 'trades_e2e_worker.mjs'), args, {
  cwd: root, stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  env: { ...process.env, NODE_ENV: 'test', FUTURES_PROVIDER: 'none',
    ...(args.includes('--offline') ? { DATABENTO_API_KEY: '' } : {}),
    STORAGE_PATH: ':memory:', ACCEPTANCE_ARTIFACT_DIR: directory },
});
let watchdog;
let cleanupDeadline;
let killed = false;
let browserPid;
let cleanup = Promise.resolve();
function stopTree(reason) {
  killed = true;
  const record = { reason, source: args.includes('--offline') ? 'OFFLINE_FIXTURE' : 'DATABENTO_LIVE', utc: new Date().toISOString(), workerPid: child.pid, browserPid, browserCleanup: 'PENDING' };
  const save = () => fs.writeFileSync(path.join(directory, 'watchdog.json'), JSON.stringify(record));
  save();
  // Terminate the worker immediately: closes vendor TCP even when its JS loop is hung.
  child.kill('SIGKILL');
  if (process.platform === 'win32' && browserPid) cleanup = new Promise(resolve => {
    execFile('taskkill.exe', ['/PID', String(browserPid), '/T', '/F'], { timeout: 10000 }, error => {
      if (!error) record.browserCleanup = 'TERMINATED_TREE';
      else {
        try { process.kill(browserPid, 0); record.browserCleanup = 'FAILED'; }
        catch { record.browserCleanup = 'ALREADY_EXITED'; }
      }
      save(); resolve();
    });
  });
}
const startup = setTimeout(() => stopTree('Startup deadline'), 60000);
child.on('message', message => {
  if (message?.type === 'BROWSER_PID' && Number.isInteger(message.pid) && message.pid > 0) browserPid = message.pid;
  if (message === 'CONNECTING') {
    clearTimeout(startup);
    // Independent parent deadline also closes a hung child/socket; never extends vendor time.
    const deadline = args.includes('--offline') && args.includes('--watchdog-probe') ? 20 : 30000;
    watchdog = setTimeout(() => { console.error('Acceptance watchdog deadline'); stopTree('Vendor deadline'); }, deadline);
  }
  if (message === 'CLOSED') {
    clearTimeout(watchdog); watchdog = undefined;
    // Vendor is already closed. This independent budget bounds browser/artifact cleanup.
    cleanupDeadline = setTimeout(() => stopTree('Cleanup deadline'), 10000);
  }
});
child.on('exit', async code => { clearTimeout(startup); clearTimeout(watchdog); clearTimeout(cleanupDeadline); await cleanup; console.log(`Private evidence: ${directory}`); process.exit(killed ? 124 : code ?? 1); });
process.once('SIGINT', () => stopTree('Operator interrupt'));
process.once('SIGTERM', () => stopTree('Operator terminate'));

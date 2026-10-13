// Loaded before any application import. Only offline entrypoints install this guard.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const sqlite = require('node:sqlite');
const { syncBuiltinESMExports } = require('node:module');
const marker = Symbol.for('deepchart.offline.guard');
if (!globalThis[marker]) {
  let violations = 0;
  const fail = reason => { violations++; throw new Error(`OFFLINE_ISOLATION: ${reason}`); };
  // A parent guard must scrub credentials; a child receiving them is a regression.
  if (process.env.DEEPCHART_OFFLINE_TEST === '1' && process.env.DATABENTO_API_KEY) fail('child inherited vendor credential');
  const child = process.env.DEEPCHART_OFFLINE_TEST === '1';
  if (child && process.env.FUTURES_PROVIDER !== 'none') fail('child provider drift');
  if (child && process.env.STORAGE_PATH !== ':memory:') fail('child storage drift');
  const nodeEnv = child && process.env.NODE_ENV === 'production' ? 'production' : 'test';
  for (const key of Object.keys(process.env)) {
    if (/^(DATABENTO_|UW_|STRIPE_|TRADOVATE_|VITE_)/.test(key)) delete process.env[key];
  }
  if (process.env.OFFLINE_TEST_WEBHOOK_SECRET === 'whsec_integration_secret') process.env.STRIPE_WEBHOOK_SECRET = 'whsec_integration_secret';
  Object.assign(process.env, { DEEPCHART_OFFLINE_TEST: '1', NODE_ENV: nodeEnv,
    FUTURES_PROVIDER: 'none', DATABENTO_API_KEY: '', STORAGE_PATH: ':memory:', ENABLE_QUOTE_BOARD: '0' });
  process.env.BACKUP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchart-offline-backups-'));
  // Do not inherit arbitrary preload code from an operator shell.
  delete process.env.NODE_OPTIONS;
  const state = { assertBackend() {
    if (process.env.FUTURES_PROVIDER !== 'none') fail('backend provider must be none');
    if (process.env.DATABENTO_API_KEY) fail('backend credential must be empty');
    if (process.env.STORAGE_PATH !== ':memory:') fail('backend storage must be memory');
  }, fail, get violations() { return violations; }, assertClean() {
    if (violations) throw new Error(`OFFLINE_ISOLATION: ${violations} forbidden attempts recorded`);
  } };
  globalThis[marker] = state;
  const isEnv = filename => typeof filename === 'string' && /^\.env(?:\..*)?$/.test(path.basename(filename));
  const read = fs.readFileSync;
  fs.readFileSync = function(filename, ...args) {
    if (isEnv(filename)) fail('credential file read forbidden');
    return read.call(this, filename, ...args);
  };
  const asyncRead = fs.promises.readFile;
  fs.promises.readFile = async function(filename, ...args) {
    if (isEnv(filename)) fail('credential file read forbidden');
    return asyncRead.call(this, filename, ...args);
  };
  process.loadEnvFile = () => fail('env hydration forbidden');
  const loopback = host => ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host);
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function(...args) {
    const options = (Array.isArray(args[0]) ? args[0] : net._normalizeArgs(args))[0];
    // Node/tsx workers use local IPC pipes; these cannot address a TCP vendor gateway.
    if (!options.path && !loopback(options.host || 'localhost')) fail('non-loopback socket forbidden');
    return connect.apply(this, args);
  };
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async function(input, ...args) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (!loopback(url.hostname)) fail('external HTTP/history/options forbidden');
    return nativeFetch.call(this, input, ...args);
  };
  const NativeDatabase = sqlite.DatabaseSync;
  const workspace = path.resolve(__dirname, '..');
  function validateDatabase(filename) {
    if (filename === ':memory:') return;
    const full = path.resolve(String(filename));
    const tmpRelative = path.relative(os.tmpdir(), full);
    const inTemp = tmpRelative && !tmpRelative.startsWith('..') && !path.isAbsolute(tmpRelative);
    const fixture = [workspace, path.join(workspace, 'server')].includes(path.dirname(full)) && /^test_[a-z0-9_]+\.sqlite$/i.test(path.basename(full));
    if (!inTemp && !fixture) fail('persistent application database forbidden');
  }
  sqlite.DatabaseSync = class extends NativeDatabase {
    constructor(filename, options) {
      validateDatabase(filename);
      super(filename, options || {});
    }
  };
  const nativeBackup = sqlite.backup;
  sqlite.backup = (source, destination, ...args) => { validateDatabase(destination); return nativeBackup(source, destination, ...args); };
  syncBuiltinESMExports();
  process.on('exit', () => {
    if (violations) { console.error(`OFFLINE_ISOLATION: ${violations} forbidden attempts`); process.exitCode = 1; }
  });
}
module.exports = globalThis[marker];

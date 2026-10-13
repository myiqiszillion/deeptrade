import './offline_guard.cjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const root = process.cwd();
const guard = path.join(root, 'scripts/offline_guard.cjs');
const base = { ...process.env, FUTURES_PROVIDER: 'none', DATABENTO_API_KEY: '', STORAGE_PATH: ':memory:' };
const cases = [
  ['scrub inherited sentinel', { DEEPCHART_OFFLINE_TEST: '', FUTURES_PROVIDER: 'databento', DATABENTO_API_KEY: 'OFFLINE_SENTINEL_NOT_A_KEY', STORAGE_PATH: path.join(root, 'data/forbidden.sqlite') }, "if(process.env.DATABENTO_API_KEY || process.env.FUTURES_PROVIDER!=='none' || process.env.STORAGE_PATH!==':memory:')throw Error('scrub failed')", true],
  ['child credential drift', { DATABENTO_API_KEY: 'OFFLINE_SENTINEL_NOT_A_KEY' }, '', false],
  ['child provider drift', { FUTURES_PROVIDER: 'databento' }, '', false],
  ['child storage drift', { STORAGE_PATH: path.join(root, 'data/forbidden.sqlite') }, '', false],
  ['credential file read', {}, "require('node:fs').readFileSync('.env')", false],
  ['env hydration', {}, 'process.loadEnvFile()', false],
  ['vendor TCP', {}, "require('node:net').createConnection({host:'offline-vendor.invalid',port:13000})", false],
  ['external HTTP/history', {}, "await fetch('https://offline-vendor.invalid/history')", false],
  ['persistent database', {}, "new (require('node:sqlite').DatabaseSync)('data/market_data.sqlite')", false],
  ['persistent backup destination', {}, "const s=require('node:sqlite');await s.backup(new s.DatabaseSync(':memory:'),'data/forbidden.sqlite')", false],
  ['HTTPS options transport', {}, "require('node:https').get('https://offline-vendor.invalid/options')", false],
  ['vendor factory/schema', {}, "const {DatabentoLiveClient}=await import('./server/dist/databento/liveClient.js');new DatabentoLiveClient({symbol:'ES',apiKey:'OFFLINE_SENTINEL_NOT_A_KEY',handlers:{}})", false],
  ['credentialed HTTP factory', {}, "const {DatabentoHttpClient}=await import('./server/dist/databento/client.js');new DatabentoHttpClient({apiKey:'OFFLINE_SENTINEL_NOT_A_KEY'})", false],
  ['history factory outside mock', {}, "const {createDatabentoHistoryProvider}=await import('./server/dist/marketData/databentoHistoryProvider.js');createDatabentoHistoryProvider()", false],
  ['explicit HTTP mock', {}, "const {DatabentoHttpClient}=await import('./server/dist/databento/client.js');const c=new DatabentoHttpClient({apiKey:'OFFLINE_SENTINEL_NOT_A_KEY',fetchFn:async()=>new Response('[]')});if(!c.configured)throw Error('mock not configured')", true],
  ['runtime provider drift at backend', {}, "process.env.FUTURES_PROVIDER='databento';await import('./server/dist/index.js')", false],
  ['expired Live approval', {}, "process.argv=['node','verify_trades_e2e.mjs','--live','--approval-date','2000-01-01'];await import('./scripts/verify_trades_e2e.mjs')", false, 'Current ICT date approval required'],
];
for (const [name, env, code, pass, expected = 'OFFLINE_ISOLATION'] of cases) {
  const source = `const require=(await import('node:module')).createRequire(import.meta.url); require(${JSON.stringify(guard)}); ${code}`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: root, env: { ...base, ...env }, encoding: 'utf8', timeout: 10000 });
  assert(!result.error, `${name}: child timeout/error`);
  assert.equal(result.status === 0, pass, name);
  if (!pass) assert((result.stderr || '').includes(expected), `${name}: missing fail-closed evidence`);
  // Only labels leave the harness; child stack/source and sentinel never reach logs/artifacts.
  console.log(`PASS ${name}`);
}
console.log(`OFFLINE ISOLATION PASS: ${cases.length} probes, no vendor endpoints used`);

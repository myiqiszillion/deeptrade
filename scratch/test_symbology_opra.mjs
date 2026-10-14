import fs from 'fs';
import { DatabentoHttpClient } from '../server/dist/databento/client.js';

let apiKey = process.env.DATABENTO_API_KEY?.trim();
if (!apiKey && fs.existsSync('.env')) {
  const envContent = fs.readFileSync('.env', 'utf8');
  const match = envContent.match(/^DATABENTO_API_KEY=(.+)$/m);
  if (match) apiKey = match[1].trim();
}

const client = new DatabentoHttpClient({ apiKey });

async function testSymbology() {
  const today = '2026-10-08';
  console.log('Testing parent SPY:');
  try {
    const res = await client.resolveSymbology('OPRA.PILLAR', ['SPY'], 'parent', 'raw_symbol', today, today);
    console.log('Parent SPY result count:', Object.keys(res.result?.SPY || {}).length, res.result?.SPY?.slice(0, 5));
  } catch (e) {
    console.log('Parent SPY err:', e.message);
  }

  console.log('Testing parent SPY.OPT:');
  try {
    const res = await client.resolveSymbology('OPRA.PILLAR', ['SPY.OPT'], 'parent', 'raw_symbol', today, today);
    console.log('Parent SPY.OPT result count:', Object.keys(res.result?.['SPY.OPT'] || {}).length, res.result?.['SPY.OPT']?.slice(0, 5));
  } catch (e) {
    console.log('Parent SPY.OPT err:', e.message);
  }
}

testSymbology();

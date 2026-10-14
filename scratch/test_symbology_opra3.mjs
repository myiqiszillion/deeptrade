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
  const startDate = '2026-10-07';
  const endDate = '2026-10-08';
  const res = await client.resolveSymbology('OPRA.PILLAR', ['SPY'], 'raw_symbol', 'instrument_id', startDate, endDate);
  console.log('SPY raw_symbol resolution:', JSON.stringify(res));
}

testSymbology();

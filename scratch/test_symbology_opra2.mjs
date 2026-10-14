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
  console.log('Testing parent SPY.OPT to instrument_id:');
  try {
    const res = await client.resolveSymbology('OPRA.PILLAR', ['SPY.OPT'], 'parent', 'instrument_id', startDate, endDate);
    const mappings = res.result?.['SPY.OPT'] || [];
    console.log('Parent SPY.OPT mapped to instrument_ids count:', mappings.length);
    if (mappings.length > 0) {
      console.log('First 3 mappings:', mappings.slice(0, 3));
    }
  } catch (e) {
    console.log('Error:', e.message);
  }
}

testSymbology();

import fs from 'fs';
import { DatabentoHttpClient } from '../server/dist/databento/client.js';

let apiKey = process.env.DATABENTO_API_KEY?.trim();
if (!apiKey && fs.existsSync('.env')) {
  const envContent = fs.readFileSync('.env', 'utf8');
  const match = envContent.match(/^DATABENTO_API_KEY=(.+)$/m);
  if (match) apiKey = match[1].trim();
}

const client = new DatabentoHttpClient({ apiKey });

async function testDef() {
  const start = '2026-10-07T00:00:00Z';
  const end = '2026-10-08T00:00:00Z';
  try {
    const res = await client.request('/timeseries.get_range', {
      dataset: 'OPRA.PILLAR',
      schema: 'definition',
      symbols: '379',
      stype_in: 'instrument_id',
      start,
      end,
      limit: 10,
    });
    console.log('Result for instrument_id 379:', res.length, res[0]);
  } catch (e) {
    console.log('Error:', e.message);
  }
}

testDef();

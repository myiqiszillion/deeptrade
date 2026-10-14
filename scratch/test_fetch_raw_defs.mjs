import fs from 'fs';
import { DatabentoHttpClient } from '../server/dist/databento/client.js';

let apiKey = process.env.DATABENTO_API_KEY?.trim();
if (!apiKey && fs.existsSync('.env')) {
  const envContent = fs.readFileSync('.env', 'utf8');
  const match = envContent.match(/^DATABENTO_API_KEY=(.+)$/m);
  if (match) apiKey = match[1].trim();
}

const client = new DatabentoHttpClient({ apiKey });

async function testFetchRawDefs() {
  const start = '2026-10-08T00:00:00Z';
  const end = '2026-10-08T08:00:00Z';
  try {
    const raw = await client.request('/timeseries.get_range', {
      dataset: 'OPRA.PILLAR',
      schema: 'definition',
      symbols: 'SPY.OPT',
      stype_in: 'parent',
      start,
      end,
      limit: 5,
    });
    console.log(`Raw definition count: ${raw.length}`);
    if (raw.length > 0) {
      console.log('Sample 0:', raw[0]);
    }
  } catch (e) {
    console.log('Error:', e.message);
  }
}

testFetchRawDefs();

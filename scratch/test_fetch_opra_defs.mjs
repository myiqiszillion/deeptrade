import fs from 'fs';
import { DatabentoHttpClient } from '../server/dist/databento/client.js';

let apiKey = process.env.DATABENTO_API_KEY?.trim();
if (!apiKey && fs.existsSync('.env')) {
  const envContent = fs.readFileSync('.env', 'utf8');
  const match = envContent.match(/^DATABENTO_API_KEY=(.+)$/m);
  if (match) apiKey = match[1].trim();
}

const client = new DatabentoHttpClient({ apiKey });

async function testFetchDefs() {
  const now = Date.now();
  const end = new Date(now - 86400000 * 2).toISOString();
  const start = new Date(now - 86400000 * 2 - 3600000).toISOString();
  console.log(`Fetching SPY option definitions from OPRA.PILLAR (${start} to ${end})...`);
  try {
    const defs = await client.getOptionDefinitions('OPRA.PILLAR', 'SPY', start, end);
    console.log(`Received ${defs.length} option definitions.`);
    if (defs.length > 0) {
      console.log('Sample definition 0:', defs[0]);
      console.log('Sample definition 1:', defs[1]);
    }
  } catch (e) {
    console.log('Error fetching option definitions:', e.message);
  }
}

testFetchDefs();

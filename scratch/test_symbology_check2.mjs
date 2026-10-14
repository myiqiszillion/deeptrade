import fs from 'fs';
import { DatabentoHttpClient } from '../server/dist/databento/client.js';

let apiKey = process.env.DATABENTO_API_KEY?.trim();
if (!apiKey && fs.existsSync('.env')) {
  const envContent = fs.readFileSync('.env', 'utf8');
  const match = envContent.match(/^DATABENTO_API_KEY=(.+)$/m);
  if (match) apiKey = match[1].trim();
}

const client = new DatabentoHttpClient({ apiKey });

async function run() {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const res = await client.resolveSymbology('GLBX.MDP3', '10252', 'instrument_id', 'raw_symbol', today);
    console.log('Resolved instrument_id -> raw_symbol:', JSON.stringify(res, null, 2));
  } catch (err) {
    console.log('instrument_id -> raw_symbol failed:', err.message);
  }
}

run();

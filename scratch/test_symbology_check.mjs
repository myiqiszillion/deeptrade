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
  console.log('Today:', today);

  try {
    const res = await client.resolveSymbology('GLBX.MDP3', 'ES.c.0', 'continuous', 'raw_symbol', today);
    console.log('Resolved continuous -> raw_symbol:', JSON.stringify(res, null, 2));
  } catch (err) {
    console.log('Continuous -> raw_symbol failed:', err.message);
  }

  try {
    const res2 = await client.resolveSymbology('GLBX.MDP3', 'ES.c.0', 'continuous', 'instrument_id', today);
    console.log('Resolved continuous -> instrument_id:', JSON.stringify(res2, null, 2));
  } catch (err) {
    console.log('Continuous -> instrument_id failed:', err.message);
  }
}

run();

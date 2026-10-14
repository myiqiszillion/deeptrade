import fs from 'fs';
import { DatabentoHttpClient } from '../server/dist/databento/client.js';

let apiKey = process.env.DATABENTO_API_KEY?.trim();
if (!apiKey && fs.existsSync('.env')) {
  const envContent = fs.readFileSync('.env', 'utf8');
  const match = envContent.match(/^DATABENTO_API_KEY=(.+)$/m);
  if (match) apiKey = match[1].trim();
}

const client = new DatabentoHttpClient({ apiKey });

async function checkMbp10() {
  const now = Date.now();
  const end = new Date(now - 86400000 * 2).toISOString();
  const start = new Date(now - 86400000 * 2 - 60000).toISOString();
  try {
    const billable = await client.getBillableSize({
      dataset: 'GLBX.MDP3',
      schema: 'mbp-10',
      symbols: 'ES.c.0',
      stypeIn: 'continuous',
      start,
      end
    });
    console.log(`mbp-10 billable size for 1 min ES.c.0: ${billable} bytes`);
  } catch (e) {
    console.log(`mbp-10 getBillableSize error: ${e.message}`);
  }
}

checkMbp10();

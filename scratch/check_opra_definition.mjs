import fs from 'fs';
import { DatabentoHttpClient } from '../server/dist/databento/client.js';

let apiKey = process.env.DATABENTO_API_KEY?.trim();
if (!apiKey && fs.existsSync('.env')) {
  const envContent = fs.readFileSync('.env', 'utf8');
  const match = envContent.match(/^DATABENTO_API_KEY=(.+)$/m);
  if (match) apiKey = match[1].trim();
}

const client = new DatabentoHttpClient({ apiKey });

async function checkOpraDefinitions() {
  console.log('--- Checking OPRA.PILLAR definition metadata for SPY ---');
  try {
    const fields = await client.listFields('OPRA.PILLAR', 'definition');
    console.log(`Fields for definition schema: ${fields.length} fields`);
  } catch (e) {
    console.log(`listFields error: ${e.message}`);
  }

  try {
    // Check billable size for definition
    const now = Date.now();
    const end = new Date(now - 86400000 * 2).toISOString();
    const start = new Date(now - 86400000 * 2 - 3600000).toISOString();
    const billable = await client.getBillableSize({
      dataset: 'OPRA.PILLAR',
      schema: 'definition',
      symbols: 'SPY.OPT',
      stypeIn: 'parent',
      start,
      end
    });
    console.log(`definition billable size for SPY.OPT: ${billable} bytes`);
  } catch (e) {
    console.log(`getBillableSize error: ${e.message}`);
  }
}

checkOpraDefinitions();

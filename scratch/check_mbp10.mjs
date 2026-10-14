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
  console.log('--- Checking GLBX.MDP3 mbp-10 metadata & availability ---');
  try {
    const fields = await client.listFields('GLBX.MDP3', 'mbp-10');
    console.log(`Fields for mbp-10 returned: ${fields.length} fields`);
  } catch (e) {
    console.log(`listFields error: ${e.message}`);
  }

  try {
    const now = Date.now();
    const end = new Date(now - 86400000 * 2).toISOString();
    const start = new Date(now - 86400000 * 2 - 60000).toISOString();
    const cost = await client.getCost('GLBX.MDP3', 'mbp-10', 'ES.c.0', start, end);
    console.log(`getCost mbp-10:`, cost);
  } catch (e) {
    console.log(`getCost mbp-10 error: ${e.message}`);
  }
}

checkMbp10();

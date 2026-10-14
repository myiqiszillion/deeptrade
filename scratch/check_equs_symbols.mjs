import fs from 'fs';
import { DatabentoHttpClient } from '../server/dist/databento/client.js';

let apiKey = process.env.DATABENTO_API_KEY?.trim();
if (!apiKey && fs.existsSync('.env')) {
  const envContent = fs.readFileSync('.env', 'utf8');
  const match = envContent.match(/^DATABENTO_API_KEY=(.+)$/m);
  if (match) apiKey = match[1].trim();
}

const client = new DatabentoHttpClient({ apiKey });

async function checkEqus() {
  console.log('--- Checking EQUS.MINI Symbology & Properties for SPY, QQQ, AAPL ---');
  const symbols = ['SPY', 'QQQ', 'AAPL'];
  const startDate = '2026-10-07';
  const endDate = '2026-10-08';

  try {
    const res = await client.resolveSymbology('EQUS.MINI', symbols, 'raw_symbol', 'instrument_id', startDate, endDate);
    console.log('Symbology resolve result:');
    for (const sym of symbols) {
      const mapped = res.result?.[sym] || [];
      const instId = mapped[0]?.s || '(none)';
      console.log(`  ${sym} -> instrument_id: ${instId} (${mapped.length > 0 ? 'OK' : 'NOT FOUND'})`);
    }
  } catch (e) {
    console.log('Symbology resolution failed:', e.message);
  }

  // Check schemas
  try {
    const schemas = await client.listSchemas('EQUS.MINI');
    console.log(`EQUS.MINI available schemas (${schemas.length}):`, schemas.join(', '));
  } catch (e) {
    console.log('listSchemas error:', e.message);
  }

  // Check publishers / venues
  try {
    const publishers = await client.listPublishers();
    const equsPubs = publishers.filter(p => p.dataset === 'EQUS.MINI');
    console.log(`EQUS.MINI publishers count: ${equsPubs.length}`);
    for (const p of equsPubs) {
      console.log(`  Publisher ID ${p.publisher_id}: ${p.venue} (${p.description})`);
    }
  } catch (e) {
    console.log('listPublishers error:', e.message);
  }
}

checkEqus();

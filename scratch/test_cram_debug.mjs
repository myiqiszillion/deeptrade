import net from 'net';
import { createHash } from 'crypto';
import fs from 'fs';

let apiKey = process.env.DATABENTO_API_KEY?.trim();
if (!apiKey && fs.existsSync('.env')) {
  const envContent = fs.readFileSync('.env', 'utf8');
  const match = envContent.match(/^DATABENTO_API_KEY=(.+)$/m);
  if (match) apiKey = match[1].trim();
}

function buildCramAuthResponse(challenge, key, dataset) {
  const bucketId = key.slice(-5);
  const sha = createHash('sha256')
    .update(`${challenge}|${key}`)
    .digest('hex');
  const auth = `${sha}-${bucketId}`;
  return `auth=${auth}|dataset=${dataset}|encoding=dbn|ts_out=0|compression=none|client=DeepChart/1.0.0\n`;
}

async function testOne(dataset) {
  const subdomain = dataset.toLowerCase().replace(/\./g, '-');
  const host = `${subdomain}.lsg.databento.com`;
  const port = 13000;

  return new Promise((resolve) => {
    console.log(`\n--- Testing ${dataset} (${host}) ---`);
    const s = net.createConnection({ host, port });
    let phase = 'cram';
    let buffer = Buffer.alloc(0);
    const timeout = setTimeout(() => {
      console.log(`⏱️ Timeout 10s on ${dataset}`);
      s.destroy();
      resolve(null);
    }, 10000);

    s.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      console.log(`[${dataset}] Raw chunk received (${chunk.length} bytes): ${chunk.toString('utf8').slice(0, 150)}`);

      if (phase === 'cram') {
        const str = buffer.toString('utf8');
        const match = str.match(/cram=([^\r\n|]+)/);
        if (match) {
          const challenge = match[1];
          const req = buildCramAuthResponse(challenge, apiKey, dataset);
          console.log(`[${dataset}] Sending CRAM auth for dataset=${dataset}...`);
          s.write(req);
          buffer = Buffer.alloc(0);
          phase = 'auth';
        }
      } else if (phase === 'auth') {
        const str = buffer.toString('utf8');
        console.log(`[${dataset}] Auth response line: ${str.trim()}`);
        clearTimeout(timeout);
        s.destroy();
        resolve(str);
      }
    });

    s.on('error', (e) => {
      console.log(`❌ [${dataset}] Error: ${e.message}`);
      clearTimeout(timeout);
      resolve(null);
    });
  });
}

async function main() {
  for (const ds of ['GLBX.MDP3', 'OPRA.PILLAR', 'EQUS.MINI']) {
    await testOne(ds);
  }
}

main();

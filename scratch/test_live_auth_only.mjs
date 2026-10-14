/**
 * Test Live CRAM-SHA256 authentication only (zero subscription, zero streaming)
 */
import net from 'net';
import { createHash } from 'crypto';
import fs from 'fs';

let apiKey = process.env.DATABENTO_API_KEY?.trim();
if (!apiKey && fs.existsSync('.env')) {
  const envContent = fs.readFileSync('.env', 'utf8');
  const match = envContent.match(/^DATABENTO_API_KEY=(.+)$/m);
  if (match) apiKey = match[1].trim();
}

if (!apiKey) {
  console.log('No API key found');
  process.exit(1);
}

const DATASETS = ['GLBX.MDP3', 'OPRA.PILLAR', 'EQUS.MINI'];

function buildCramAuthResponse(challenge, key, dataset) {
  const bucketId = key.slice(-5);
  const sha = createHash('sha256')
    .update(`${challenge}|${key}`)
    .digest('hex');
  const auth = `${sha}-${bucketId}`;
  return `auth=${auth}|dataset=${dataset}|encoding=dbn|ts_out=0|compression=none|client=DeepChart/1.0.0\n`;
}

async function testLiveAuth(dataset) {
  const subdomain = dataset.toLowerCase().replace(/\./g, '-');
  const host = `${subdomain}.lsg.databento.com`;
  const port = 13000;

  return new Promise((resolve) => {
    console.log(`Connecting to ${host}:${port} for ${dataset}...`);
    const socket = net.createConnection({ host, port });
    let phase = 'cram';
    let buffer = Buffer.alloc(0);
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve({ dataset, success: false, reason: 'TIMEOUT_10S' });
    }, 10000);

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      if (phase === 'cram') {
        const nlIdx = buffer.indexOf(10);
        if (nlIdx !== -1) {
          const line = buffer.subarray(0, nlIdx).toString('utf8');
          buffer = buffer.subarray(nlIdx + 1);
          const match = line.match(/cram=([^\r\n|]+)/);
          if (match) {
            const challenge = match[1];
            const authReq = buildCramAuthResponse(challenge, apiKey, dataset);
            socket.write(authReq);
            phase = 'auth';
          }
        }
      }

      if (phase === 'auth') {
        const nlIdx = buffer.indexOf(10);
        if (nlIdx !== -1) {
          const line = buffer.subarray(0, nlIdx).toString('utf8');
          clearTimeout(timeout);
          socket.destroy(); // Close immediately!
          if (line.includes('success=1')) {
            const sessMatch = line.match(/session_id=([^\r\n|]+)/);
            resolve({ dataset, success: true, sessionId: sessMatch ? sessMatch[1] : 'ok' });
          } else {
            const errMatch = line.match(/error=([^\r\n|]+)/);
            resolve({ dataset, success: false, reason: errMatch ? errMatch[1] : line });
          }
        }
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      socket.destroy();
      resolve({ dataset, success: false, reason: `TCP_ERR: ${err.message}` });
    });
  });
}

async function run() {
  for (const ds of DATASETS) {
    const res = await testLiveAuth(ds);
    console.log(`Result for ${ds}:`, res);
  }
}

run();

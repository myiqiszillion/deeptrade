import net from 'net';

for (const host of ['glbx-mdp3.lsg.databento.com', 'opra-pillar.lsg.databento.com', 'equs-mini.lsg.databento.com']) {
  console.log(`Testing TCP connect to ${host}:13000...`);
  const s = net.createConnection({ host, port: 13000 });
  const t0 = Date.now();
  s.setTimeout(5000);
  s.on('connect', () => {
    console.log(`✅ [${host}] Connected in ${Date.now() - t0}ms`);
  });
  s.on('data', (d) => {
    console.log(`📨 [${host}] Received data: ${d.toString('utf8').trim()}`);
    s.destroy();
  });
  s.on('timeout', () => {
    console.log(`⏱️ [${host}] Socket timeout after ${Date.now() - t0}ms`);
    s.destroy();
  });
  s.on('error', (err) => {
    console.log(`❌ [${host}] Error: ${err.message}`);
  });
}

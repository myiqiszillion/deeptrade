import WebSocket from 'ws';

console.log('Testing WebSocket connection to wss://localhost/ ...');

const ws = new WebSocket('wss://localhost/', {
  rejectUnauthorized: false
});

ws.on('open', () => {
  console.log('WS OPENED successfully!');
  ws.close();
  process.exit(0);
});

ws.on('message', (data) => {
  console.log('WS MESSAGE:', data.toString());
});

ws.on('error', (err) => {
  console.error('WS ERROR:', err.message);
  process.exit(1);
});

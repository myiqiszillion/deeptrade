// Hermetic binary vendor fixture. Always labeled OFFLINE_FIXTURE by the controller.
export function tradeRecord(index, side = ['B', 'A', 'N'][index % 3], size = index + 1) {
  const b = Buffer.alloc(48); b[0] = 12; b[1] = 0;
  b.writeUInt32LE(10252, 4);
  b.writeBigUInt64LE(BigInt(1791804548000 + index) * 1000000n, 8);
  b.writeBigInt64LE(BigInt(786400 + index % 3 * 25) * 10000000n, 16);
  b.writeUInt32LE(size, 24); b[28] = 84; b[29] = side.charCodeAt(0);
  b.writeBigUInt64LE(BigInt(1791804548000 + index) * 1000000n + 123n, 32);
  b.writeUInt32LE(100 + index * 10, 44); return b;
}
export function systemRecord(error = false) {
  const b = Buffer.alloc(320); b[0] = 80; b[1] = error ? 21 : 23;
  b.write(error ? 'Offline entitlement denial' : 'Subscription request for trades data succeeded', 16);
  b[error ? 318 : 319] = 1; return b;
}
export function metadata() { const b = Buffer.alloc(128); b.write('DBN'); b[3] = 3; b.writeUInt32LE(120, 4); return b; }

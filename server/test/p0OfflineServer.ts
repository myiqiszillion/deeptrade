import '../../scripts/offline_guard.cjs';
// Regression-only bootstrap: fixtures never enter the persistent application store.
if (process.env.NODE_ENV !== 'test' || process.env.FUTURES_PROVIDER !== 'none' || process.env.DATABENTO_API_KEY || process.env.STORAGE_PATH !== ':memory:') {
  throw new Error('P0 requires offline provider and in-memory storage');
}
globalThis.fetch = async () => { throw new Error('P0 prohibits external fetch'); };
async function main() {
  const { offlineTerminalTestContext } = await import('../src/index.js');
  for (const symbol of ['ES', 'NQ']) {
    const context = await offlineTerminalTestContext(symbol);
    for (let i = 0; i < 50; i++) {
      (context as any).handleTrade({ id: `p0-fixture-${symbol}-${i}`, ts: Date.now() - 10000 + i * 100,
        price: 100 + i % 3 * 0.25, size: 1, side: i % 2 ? 'SELL' : 'BUY',
        sourceProvider: 'fixture', aggressorProvenance: 'EXCHANGE_NATIVE' });
    }
  }
}
void main().catch(error => { console.error(error); process.exit(1); });

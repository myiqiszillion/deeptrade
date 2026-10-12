import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Read props of mounted production components; no alternate React reducer/observer.
export async function terminalState(page) {
  return page.evaluate(() => {
    const result = {};
    const root = document.getElementById('root');
    const key = Object.keys(root).find(k => k.startsWith('__reactContainer$'));
    const stack = key ? [root[key].stateNode.current] : [];
    while (stack.length) {
      const f = stack.pop();
      if (f.child) stack.push(f.child); if (f.sibling) stack.push(f.sibling);
      const p = f.memoizedProps;
      if (!p || typeof f.type !== 'function') continue;
      if (p.bars && p.chartMode && p.onFixedRangeSelect) result.footprint = { bars: p.bars, symbol: p.symbol, timeframe: p.timeframe, chartMode: p.chartMode };
      if (p.bars && p.onHeightChange && 'currentCVD' in p) result.cvd = p.currentCVD;
      if (p.volumeProfile && p.tpoProfile && 'currentPrice' in p && !('activePanel' in p)) result.profile = p.volumeProfile;
      if (p.instrument && p.onSelectSymbol) { result.instrument = p.instrument; result.feedStatus = p.feedStatus; }
    }
    return result;
  });
}

export async function verifyTerminal(page, final, frames, traces) {
  let state;
  for (let attempt = 0; attempt < 40; attempt++) {
    state = await terminalState(page);
    if (state.profile?.totalVolume === final.acceptedVolume && state.footprint?.bars.reduce((n, b) => n + b.volume, 0) === final.acceptedVolume) break;
    await page.waitForTimeout(100);
  }
  assert.equal(state.footprint?.symbol, 'ES'); assert.equal(state.instrument?.symbol, 'ES');
  await page.waitForTimeout(200);
  assert.equal((await terminalState(page)).feedStatus, 'UNAVAILABLE', 'Closed vendor must remain unavailable after pending UI tick flush');
  assert.equal(state.footprint.timeframe, '1m');
  assert.deepEqual(state.footprint.bars, final.snapshot.bars);
  assert.deepEqual(state.profile, final.snapshot.profile);
  const digest = createHash('sha256').update(JSON.stringify({ bars: state.footprint.bars, profile: state.profile })).digest('hex');
  assert.equal(digest, final.digest);
  assert.equal(state.cvd, final.signedContributions.reduce((n, v) => n + v, 0));
  assert.equal(state.profile.coverage, 'PARTIAL');
  assert(frames.some(m => m.type === 'BAR_UPDATE'));
  assert(frames.some(m => m.type === 'PROFILE_UPDATE' && m.volumeProfile.totalVolume === final.acceptedVolume));
  assert.equal(frames.filter(m => m.type === 'TICK').length, final.acceptedCount);
  const ticks = frames.filter(m => m.type === 'TICK').map(m => m.tick);
  assert.equal(ticks.reduce((n, t) => n + t.size, 0), final.acceptedVolume);
  assert.equal(ticks.filter(t => t.side === 'unknown').reduce((n, t) => n + t.size, 0), final.unknownVolume);
  assert.equal(ticks.reduce((n, t) => n + (t.side === 'buy' ? t.size : t.side === 'sell' ? -t.size : 0), 0), state.cvd);
  const accepted = traces.filter(t => t.outcome === 'ACCEPTED');
  assert.deepEqual(ticks.map(t => [t.price, t.size, t.timestamp, t.side, t.receiveTs]),
    accepted.map(t => [t.price, t.size, Number(BigInt(t.eventTimestampNs) / 1000000n), t.normalizedSide.toLowerCase(), t.localReceiveTimestamp]));
  const volumes = new Map();
  for (const t of accepted) { const bin = Math.round(t.price / 0.25) * 0.25; volumes.set(bin, (volumes.get(bin) || 0) + t.size); }
  const maxVolume = Math.max(...volumes.values());
  assert.equal(volumes.get(state.profile.poc), maxVolume);
  assert(ticks.every(t => t.sourceProvider === (final.source === 'OFFLINE_FIXTURE' ? 'fixture' : 'databento')));
  assert(frames.every(m => !m.symbol || m.symbol === 'ES'));
  assert(!frames.some(m => m.type === 'ACCEPTANCE'));
  await page.locator('button[title="Switch to candles mode"]').click();
  await page.waitForTimeout(150);
  const candles = await terminalState(page);
  assert.equal(candles.footprint.chartMode, 'candles');
  assert.deepEqual(candles.footprint.bars, final.snapshot.bars);
  assert(await page.locator('#chart-surface canvas').first().evaluate(c => c.width > 0 && c.height > 0));
  return { state, candles, digest, messageCounts: frames.reduce((a, m) => ({ ...a, [m.type]: (a[m.type] || 0) + 1 }), {}), status: 'NUMERIC_MATCH' };
}

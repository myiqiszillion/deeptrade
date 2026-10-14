import { FuturesInstrument } from '../futuresConfig.js';
import { FeedHandlers, MarketDataFeed } from './types.js';
import { DatabentoLiveClient } from '../databento/liveClient.js';
import { ordinaryRuntime, OrdinaryRuntimeGate } from './ordinaryRuntime.js';

export function ordinaryProviderForSymbol(symbol: string): 'none' | 'databento' {
  return ordinaryRuntime()?.allows(symbol) ? 'databento' : 'none';
}

/** Injection is in-process only; offline tests keep environment pinned by offline_guard. */
export function createMarketDataFeed(symbol: string, _instrument: FuturesInstrument, handlers: FeedHandlers,
  gate: OrdinaryRuntimeGate | undefined = ordinaryRuntime(), mockConnection?: typeof import('net').createConnection
): { feed: MarketDataFeed; provider: 'none' | 'databento' } {
  const guard = (globalThis as any)[Symbol.for('deepchart.offline.guard')];
  guard?.assertBackend();
  if (mockConnection && !guard) throw new Error('Ordinary mock transport requires offline guard');
  if (gate?.allows(symbol)) {
    const p = gate.profile!;
    const feed = new DatabentoLiveClient({ symbol: p.vendorSymbol, dataset: p.dataset, schema: p.schema,
      apiKey: gate.credentials(), handlers,
      ordinary: { createConnection: mockConnection, expiresAt: p.expiresAt,
        beforeConnect: () => gate.claimConnection(symbol), onSubscription: () => gate.subscription(), onAck: () => gate.ack() },
    });
    return { feed, provider: 'databento' };
  }
  const reason = gate?.profile ? `Symbol ${symbol} denied by approved ordinary runtime profile` : gate?.reason || 'No approved ordinary runtime profile: vendor activation OFF';
  return { provider: 'none', feed: { provider: 'none', symbol,
    connect: async () => { handlers.onStatus({ state: 'DISABLED', reason, provider: 'none', symbol }); },
    disconnect: async () => {}, isConnected: () => false } };
}

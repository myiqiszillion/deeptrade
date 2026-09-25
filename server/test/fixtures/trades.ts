import { MarketTrade } from '../../src/marketData/types.js';
import { Tick } from '../../src/types.js';

export const sampleTicks: Tick[] = [
  {
    id: 't_1',
    timestamp: 1700000000000,
    price: 5000.25,
    size: 5,
    side: 'buy',
    receiveTs: 1700000000005,
    aggressorProvenance: 'EXCHANGE_NATIVE',
  },
  {
    id: 't_2',
    timestamp: 1700000001000,
    price: 5000.5,
    size: 10,
    side: 'sell',
    receiveTs: 1700000001004,
    aggressorProvenance: 'INFERRED_TICK',
  },
  {
    id: 't_3',
    timestamp: 1700000001000,
    price: 5000.5,
    size: 2,
    side: 'buy',
    receiveTs: 1700000001006,
    aggressorProvenance: 'INFERRED_QUOTE',
  },
];

export const sampleMarketTrades: MarketTrade[] = [
  {
    price: 5000.25,
    size: 5,
    side: 'BUY',
    ts: 1700000000000,
    receiveTs: 1700000000005,
    aggressorProvenance: 'EXCHANGE_NATIVE',
  },
  {
    price: 5000.5,
    size: 10,
    side: 'SELL',
    ts: 1700000001000,
    receiveTs: 1700000001004,
    aggressorProvenance: 'INFERRED_TICK',
  },
];

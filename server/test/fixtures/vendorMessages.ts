import { TradovateQuote } from '../../src/marketData/tradovateTransport.js';

export const sampleTradovateQuotes: TradovateQuote[] = [
  {
    timestamp: '2026-01-05T14:30:00.123Z',
    contractId: 12345,
    entries: {
      Bid: { price: 5000.0, size: 10 },
      Offer: { price: 5000.25, size: 15 },
      Trade: { price: 5000.25, size: 5 },
    },
  },
  {
    timestamp: '2026-01-05T14:30:01.456Z',
    contractId: 12345,
    entries: {
      Bid: { price: 5000.0, size: 12 },
      Offer: { price: 5000.25, size: 8 },
      Trade: { price: 5000.0, size: 3 },
    },
  },
];

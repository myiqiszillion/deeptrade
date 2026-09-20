import WebSocket from 'ws';
import { Tick } from '../types.js';

export interface DataFeedCallbacks {
  onTick: (tick: Tick) => void;
  onOrderbookSnapshot: (bids: [number, number][], asks: [number, number][], updateId: number) => void;
  onOrderbookDelta: (bids: [number, number][], asks: [number, number][], updateId: number) => void;
}

export class BinanceFuturesFeed {
  private symbol: string;
  private wsTrade: WebSocket | null = null;
  private wsDepth: WebSocket | null = null;
  private callbacks: DataFeedCallbacks;
  private isRunning = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(symbol: string, callbacks: DataFeedCallbacks) {
    this.symbol = symbol.toLowerCase();
    this.callbacks = callbacks;
  }

  public start() {
    this.isRunning = true;
    this.connectTradeStream();
    this.connectDepthStream();
  }

  public stop() {
    this.isRunning = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.wsTrade) {
      this.wsTrade.close();
      this.wsTrade = null;
    }
    if (this.wsDepth) {
      this.wsDepth.close();
      this.wsDepth = null;
    }
  }

  private connectTradeStream() {
    if (!this.isRunning) return;
    const url = `wss://stream.binance.com:9443/ws/${this.symbol}@aggTrade`;
    this.wsTrade = new WebSocket(url);

    this.wsTrade.on('open', () => {
      console.log(`[BinanceFeed] Connected to aggTrade stream for ${this.symbol}`);
    });

    this.wsTrade.on('message', (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());
        // Binance aggTrade format:
        // { e: 'aggTrade', E: timestamp, s: 'BTCUSDT', a: aggTradeId, p: 'price', q: 'quantity', f: firstTradeId, l: lastTradeId, T: tradeTime, m: isBuyerMaker }
        if (msg.e === 'aggTrade') {
          const price = parseFloat(msg.p);
          const size = parseFloat(msg.q);
          const isBuyerMaker = msg.m; // true: sell market order, false: buy market order
          const tick: Tick = {
            id: String(msg.a),
            timestamp: msg.T,
            price,
            size,
            side: isBuyerMaker ? 'sell' : 'buy',
            isBuyerMaker,
          };
          this.callbacks.onTick(tick);
        }
      } catch (err) {
        console.error('[BinanceFeed] Error parsing trade message:', err);
      }
    });

    this.wsTrade.on('error', (err) => {
      console.error('[BinanceFeed] aggTrade WebSocket error:', err.message);
    });

    this.wsTrade.on('close', () => {
      if (this.isRunning) {
        console.log('[BinanceFeed] aggTrade closed, reconnecting in 3s...');
        setTimeout(() => this.connectTradeStream(), 3000);
      }
    });
  }

  private connectDepthStream() {
    if (!this.isRunning) return;
    const url = `wss://stream.binance.com:9443/ws/${this.symbol}@depth20`;
    this.wsDepth = new WebSocket(url);

    this.wsDepth.on('open', () => {
      console.log(`[BinanceFeed] Connected to depth20 for ${this.symbol}`);
    });

    this.wsDepth.on('message', (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());
        const rawBids = msg.bids || msg.b;
        const rawAsks = msg.asks || msg.a;

        if (rawBids && rawAsks) {
          const bids: [number, number][] = rawBids.map(([p, q]: [string, string]) => [parseFloat(p), parseFloat(q)]);
          const asks: [number, number][] = rawAsks.map(([p, q]: [string, string]) => [parseFloat(p), parseFloat(q)]);
          this.callbacks.onOrderbookSnapshot(bids, asks, msg.lastUpdateId || msg.u || Date.now());
        }
      } catch (err) {
        console.error('[BinanceFeed] Error parsing depth message:', err);
      }
    });

    this.wsDepth.on('error', (err) => {
      console.error('[BinanceFeed] depth WebSocket error:', err.message);
    });

    this.wsDepth.on('close', () => {
      if (this.isRunning) {
        console.log('[BinanceFeed] depth closed, reconnecting in 3s...');
        setTimeout(() => this.connectDepthStream(), 3000);
      }
    });
  }
}

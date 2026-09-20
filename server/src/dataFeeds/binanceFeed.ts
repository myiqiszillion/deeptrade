import WebSocket from 'ws';
import { Tick } from '../types.js';

export interface DataFeedCallbacks {
  onTick: (tick: Tick) => void;
  onOrderbookSnapshot: (bids: [number, number][], asks: [number, number][], updateId: number) => void;
  onOrderbookDelta: (bids: [number, number][], asks: [number, number][], updateId: number) => void;
}

/**
 * Socket factory seam. Production passes `ws`; deterministic lifecycle tests inject a scripted
 * socket so teardown/reconnect/close ordering can be exercised without touching the network.
 */
export type SocketFactory = (url: string) => WebSocket;

export class BinanceFuturesFeed {
  private symbol: string;
  private wsTrade: WebSocket | null = null;
  private wsDepth: WebSocket | null = null;
  private callbacks: DataFeedCallbacks;
  private isRunning = false;
  // Lifecycle instrumentation: correlate every socket with the feed instance that owns it.
  private static nextId = 1;
  private readonly feedId = BinanceFuturesFeed.nextId++;
  private socketsCreated = 0;
  private socketsOpened = 0;
  private socketsClosed = 0;
  // One timer per stream: a single shared field cannot cancel both reconnects and silently
  // lost one of them, so a stopped instance could still have a pending reconnect.
  private tradeReconnectTimer: NodeJS.Timeout | null = null;
  private depthReconnectTimer: NodeJS.Timeout | null = null;
  /** True once teardown was requested: late callbacks are expected and must stay silent. */
  private intentionalStop = false;

  constructor(
    symbol: string,
    callbacks: DataFeedCallbacks,
    private readonly socketFactory: SocketFactory = (url) => new WebSocket(url)
  ) {
    this.symbol = symbol.toLowerCase();
    this.callbacks = callbacks;
  }

  public start() {
    this.isRunning = true;
    this.intentionalStop = false;
    this.connectTradeStream();
    this.connectDepthStream();
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    // Mark the teardown as intentional so late error/close callbacks are treated as expected
    // (they still must not reconnect or mutate state) and are not logged as feed failures.
    this.intentionalStop = true;
    if (this.tradeReconnectTimer) {
      clearTimeout(this.tradeReconnectTimer);
      this.tradeReconnectTimer = null;
    }
    if (this.depthReconnectTimer) {
      clearTimeout(this.depthReconnectTimer);
      this.depthReconnectTimer = null;
    }

    const sockets = [this.wsTrade, this.wsDepth].filter((socket): socket is WebSocket => socket !== null);
    this.wsTrade = null;
    this.wsDepth = null;

    // Arming order matters: the close watcher is attached BEFORE the socket is torn down. If it
    // were attached afterwards, a socket that settles synchronously on close()/terminate() would
    // miss the event and stall teardown until the safety bound. Detaching first also means a
    // socket that is still CONNECTING cannot emit error/close into the feed after teardown, and
    // the no-op error listener keeps an intentional abort from surfacing as an uncaught 'error'.
    const settled = sockets.map(
      (socket) =>
        new Promise<void>((resolve) => {
          socket.removeAllListeners();
          socket.on('error', () => {
            /* expected during intentional teardown */
          });
          if (socket.readyState === WebSocket.CLOSED) {
            resolve();
            return;
          }
          socket.once('close', () => resolve());
        })
    );

    for (const socket of sockets) {
      try {
        if (socket.readyState === WebSocket.CONNECTING) {
          // ws throws/emits "closed before the connection was established" on close() while
          // CONNECTING; terminate() is the supported way to abort a pending connection.
          socket.terminate();
        } else if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CLOSING) {
          socket.close();
        }
      } catch {
        /* already settled */
      }
    }

    // Bounded settlement: resolve as soon as every socket is closed. The bound exists only so
    // teardown can never hang — it is NOT a readiness delay.
    await Promise.race([Promise.all(settled), new Promise<void>((resolve) => setTimeout(resolve, 1500))]);
  }

  private connectTradeStream() {
    if (!this.isRunning) return;
    const url = `wss://stream.binance.com:9443/ws/${this.symbol}@aggTrade`;
    this.wsTrade = this.socketFactory(url);
    this.socketsCreated++;
    console.log(`[BinanceFeed] feed=${this.feedId} symbol=${this.symbol} event=TRADE_SOCKET_CONNECTING sockets=${this.socketsCreated}`);

    this.wsTrade.on('open', () => {
      this.socketsOpened++;
      console.log(
        `[BinanceFeed] feed=${this.feedId} symbol=${this.symbol} event=TRADE_SOCKET_OPEN opened=${this.socketsOpened}/${this.socketsCreated}`
      );
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
      this.socketsClosed++;
      if (this.intentionalStop || !this.isRunning) {
        console.log(
          `[BinanceFeed] feed=${this.feedId} symbol=${this.symbol} event=TRADE_SOCKET_CLOSE intentional closed=${this.socketsClosed}/${this.socketsCreated}`
        );
        return;
      }
      console.log('[BinanceFeed] aggTrade closed, reconnecting in 3s...');
      if (this.tradeReconnectTimer) clearTimeout(this.tradeReconnectTimer);
      this.tradeReconnectTimer = setTimeout(() => {
        this.tradeReconnectTimer = null;
        if (this.intentionalStop || !this.isRunning) return; // generation/lifecycle guard
        this.connectTradeStream();
      }, 3000);
    });
  }

  private connectDepthStream() {
    if (!this.isRunning) return;
    const url = `wss://stream.binance.com:9443/ws/${this.symbol}@depth20`;
    this.wsDepth = this.socketFactory(url);

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
      if (this.intentionalStop || !this.isRunning) return; // teardown: never reconnect
      console.log('[BinanceFeed] depth closed, reconnecting in 3s...');
      if (this.depthReconnectTimer) clearTimeout(this.depthReconnectTimer);
      this.depthReconnectTimer = setTimeout(() => {
        this.depthReconnectTimer = null;
        if (this.intentionalStop || !this.isRunning) return; // generation/lifecycle guard
        this.connectDepthStream();
      }, 3000);
    });
  }
}

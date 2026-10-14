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

/**
 * Trade stream flavor.
 *
 * `trade` streams every single fill; `aggTrade` aggregates fills (lower bandwidth). Some
 * networks/edges silently accept `@aggTrade` and then never deliver a single trade even though the
 * depth stream on the same host keeps ticking, which would leave BTCUSDT stuck at UNAVAILABLE.
 *
 * Default is therefore `trade` (always delivered, and per-fill data is strictly better for
 * footprint accuracy). `auto` opts into aggTrade-first with an automatic fallback, `aggTrade`
 * pins the aggregated stream.
 */
type BinanceTradeStream = 'aggTrade' | 'trade';
type BinanceTradeStreamMode = 'auto' | BinanceTradeStream;

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
  // Trade-stream resilience state (see BinanceTradeStream docs above).
  private readonly tradeSilenceMs: number;
  private readonly tradeStreamMode: BinanceTradeStreamMode;
  private tradeStream: BinanceTradeStream = 'trade';
  private tradeFallbackApplied = false;
  private tradeWatchdog: NodeJS.Timeout | null = null;
  private lastTradeMessageTs = 0;
  private lastDepthMessageTs = 0;

  constructor(
    symbol: string,
    callbacks: DataFeedCallbacks,
    private readonly socketFactory: SocketFactory = (url) => new WebSocket(url)
  ) {
    this.symbol = symbol.toLowerCase();
    this.callbacks = callbacks;
    // Read per instance (not per module) so tests can pin the mode and the watchdog window.
    this.tradeSilenceMs = Math.max(250, parseInt(process.env.BINANCE_TRADE_SILENCE_MS || '6000', 10));
    const mode = (process.env.BINANCE_TRADE_STREAM || 'trade').trim().toLowerCase();
    this.tradeStreamMode = mode === 'auto' ? 'auto' : mode === 'aggtrade' ? 'aggTrade' : 'trade';
    // 'auto' starts on aggTrade (with the watchdog); the default 'trade' starts on @trade.
    this.tradeStream = this.tradeStreamMode === 'trade' ? 'trade' : 'aggTrade';
  }

  public start() {
    this.isRunning = true;
    this.intentionalStop = false;
    this.tradeStream = this.tradeStreamMode === 'trade' ? 'trade' : 'aggTrade';
    this.tradeFallbackApplied = this.tradeStreamMode !== 'auto';
    this.lastTradeMessageTs = 0;
    this.lastDepthMessageTs = 0;
    this.clearTradeWatchdog();
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
    this.clearTradeWatchdog();

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
    const stream = this.tradeStream;
    const url = `wss://fstream.binance.com/ws/${this.symbol}@${stream}`;
    const socket = this.socketFactory(url);
    this.wsTrade = socket;
    this.socketsCreated++;
    console.log(`[BinanceFeed] feed=${this.feedId} symbol=${this.symbol} event=TRADE_SOCKET_CONNECTING sockets=${this.socketsCreated} stream=${stream}`);

    socket.on('open', () => {
      if (this.wsTrade !== socket) return; // superseded socket (fallback/reconnect)
      this.socketsOpened++;
      console.log(
        `[BinanceFeed] feed=${this.feedId} symbol=${this.symbol} event=TRADE_SOCKET_OPEN opened=${this.socketsOpened}/${this.socketsCreated}`
      );
      this.armTradeWatchdog(socket);
    });

    socket.on('message', (data: WebSocket.Data) => {
      if (this.wsTrade !== socket) return; // superseded socket (fallback/reconnect)
      try {
        const msg = JSON.parse(data.toString());
        // Binance USD-M Futures trade formats:
        //   aggTrade: { e: 'aggTrade', E, s, a: aggTradeId, p, q, f, l, T, m }
        //   trade:    { e: 'trade',    E, T, s, t: tradeId,    p, q, X, m }
        // `m` = isBuyerMaker (true: sell market order, false: buy market order) in both.
        if (msg.e !== 'aggTrade' && msg.e !== 'trade') return;

        const price = parseFloat(msg.p);
        const size = parseFloat(msg.q);
        const rawId = msg.e === 'aggTrade' ? msg.a : msg.t;
        // `@trade` also carries lifecycle rows (X: 'NA') with zero price/size — they are not trades.
        if (
          !Number.isFinite(price) ||
          price <= 0 ||
          !Number.isFinite(size) ||
          size <= 0 ||
          rawId === undefined ||
          rawId === null
        ) {
          return;
        }

        // A real trade arrived: the stream is alive, so the silence watchdog is unnecessary.
        this.lastTradeMessageTs = Date.now();
        this.clearTradeWatchdog();

        const isBuyerMaker = msg.m === true;
        // Only aggTrade ids are contiguous per symbol. `@trade` ids skip carriers (X: 'NA') and
        // other vendor rows, so claiming them as a sequence would raise false gap alarms.
        const sequenceId = msg.e === 'aggTrade' ? String(rawId) : undefined;
        const tick: Tick = {
          id: String(rawId),
          timestamp: Number.isFinite(msg.T) ? msg.T : Date.now(),
          price,
          size,
          side: isBuyerMaker ? 'sell' : 'buy',
          isBuyerMaker,
          receiveTs: Date.now(),
          aggressorProvenance: 'EXCHANGE_NATIVE',
          sequenceId,
          sourceProvider: 'binance',
        };
        this.callbacks.onTick(tick);
      } catch (err) {
        console.error('[BinanceFeed] Error parsing trade message:', err);
      }
    });

    socket.on('error', (err) => {
      console.error(`[BinanceFeed] ${stream} WebSocket error:`, err.message);
    });

    socket.on('close', () => {
      this.socketsClosed++;
      this.clearTradeWatchdog();
      if (this.intentionalStop || !this.isRunning) {
        console.log(
          `[BinanceFeed] feed=${this.feedId} symbol=${this.symbol} event=TRADE_SOCKET_CLOSE intentional closed=${this.socketsClosed}/${this.socketsCreated}`
        );
        return;
      }
      console.log(`[BinanceFeed] ${stream} closed, reconnecting in 3s...`);
      if (this.tradeReconnectTimer) clearTimeout(this.tradeReconnectTimer);
      this.tradeReconnectTimer = setTimeout(() => {
        this.tradeReconnectTimer = null;
        if (this.intentionalStop || !this.isRunning) return; // generation/lifecycle guard
        this.connectTradeStream();
      }, 3000);
    });
  }

  /**
   * Watchdog for a silently dead trade stream.
   *
   * Silence alone is never enough to switch streams: the fallback also requires the vendor to be
   * provably reachable (depth data within the same window), so a genuinely quiet market cannot
   * trigger it. Runs once per feed instance — after the switch, `trade` is the settled choice.
   */
  private armTradeWatchdog(socket: WebSocket): void {
    this.clearTradeWatchdog();
    if (this.tradeFallbackApplied || this.tradeStreamMode !== 'auto' || !this.isRunning) return;

    this.lastTradeMessageTs = 0;
    this.tradeWatchdog = setTimeout(() => {
      this.tradeWatchdog = null;
      if (this.intentionalStop || !this.isRunning) return;
      if (this.wsTrade !== socket) return;
      if (this.lastTradeMessageTs > 0) return; // real trades are flowing
      if (Date.now() - this.lastDepthMessageTs > this.tradeSilenceMs) return; // vendor unreachable

      console.warn(
        `[BinanceFeed] ${this.symbol}@aggTrade delivered no trades in ${this.tradeSilenceMs}ms while depth is live — falling back to @trade`
      );
      this.tradeStream = 'trade';
      this.tradeFallbackApplied = true;

      // Detach first so the abandoned socket can neither reconnect nor emit into the new stream.
      try {
        socket.removeAllListeners();
        socket.on('error', () => {
          /* expected: the silent socket is being abandoned */
        });
        socket.terminate();
      } catch {
        /* already settled */
      }
      if (this.wsTrade === socket) this.wsTrade = null;
      this.connectTradeStream();
    }, this.tradeSilenceMs);
    this.tradeWatchdog.unref?.();
  }

  private clearTradeWatchdog(): void {
    if (this.tradeWatchdog) {
      clearTimeout(this.tradeWatchdog);
      this.tradeWatchdog = null;
    }
  }

  private connectDepthStream() {
    if (!this.isRunning) return;
    const url = `wss://fstream.binance.com/ws/${this.symbol}@depth20@100ms`;
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
          // Depth flowing == the vendor is provably reachable (used by the trade-stream watchdog).
          this.lastDepthMessageTs = Date.now();
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

import { WebSocket } from 'ws';
import { WSServerMessage } from './types.js';

let sessionCounter = 0;

/**
 * Per-connection chart session.
 *
 * In DeepChart Free (Chart Only), connections receive market data, footprint, profile,
 * VWAP and tape updates. Trading accounts, orders and prop firm risk engines are not part
 * of this edition.
 */
export class ChartSession {
  public readonly id = `s${++sessionCounter}`;
  public readonly createdAt = Date.now();
  public subscribedSymbol = 'BTCUSDT';
  public subscribedTimeframe = '1m';

  private messageTimestamps: number[] = [];

  constructor(private readonly socket: WebSocket) {}

  public get isOpen(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }

  /** Send a message to this session's client only. */
  public send(msg: WSServerMessage): void {
    if (!this.isOpen) return;
    this.socket.send(JSON.stringify(msg));
  }

  /** Simple flood protection: a public server cannot trust any single client's send rate. */
  public allowMessage(limitPerSecond = parseInt(process.env.MAX_MESSAGES_PER_SEC || '40', 10)): boolean {
    const now = Date.now();
    this.messageTimestamps = this.messageTimestamps.filter((t) => now - t < 1000);
    if (this.messageTimestamps.length >= limitPerSecond) return false;
    this.messageTimestamps.push(now);
    return true;
  }
}

/** Backward-compatible alias for any residual imports during migration. */
export type TradingSession = ChartSession;

export const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || '500', 10);


import { WebSocket } from 'ws';
import { JournalEngine } from './journalEngine.js';
import { PropRiskEngine } from './propRiskEngine.js';
import { TradeCopierEngine } from './tradeCopier.js';
import { RestingOrder, WSServerMessage } from './types.js';

let sessionCounter = 0;

/**
 * Per-connection account state.
 *
 * Market data (footprint, profile, VWAP, tape, orderbook, GEX) is global because every
 * visitor watches the same feed. Trading state must NOT be: orders, journal and prop-firm
 * risk have to be private per visitor, otherwise a public deployment would have everyone
 * trading one shared account.
 */
export class TradingSession {
  public readonly id = `s${++sessionCounter}`;
  public readonly journal = new JournalEngine();
  public readonly propRisk = new PropRiskEngine();
  public readonly copier = new TradeCopierEngine();
  public readonly createdAt = Date.now();

  public restingOrders: RestingOrder[] = [];
  public pendingAutoFlatten = false;
  public sessionDate = new Date().toISOString().slice(0, 10);
  public lastPropBroadcast = 0;

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

  public setPointValue(pointValue: number): void {
    this.journal.setPointValue(pointValue);
  }

  public pendingContracts(symbol: string): number {
    return this.restingOrders.filter((o) => o.symbol === symbol).reduce((sum, o) => sum + o.size, 0);
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

export const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || '500', 10);

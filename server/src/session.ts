import { WebSocket } from 'ws';
import { User } from './auth/types.js';
import { WSServerMessage } from './types.js';

let sessionCounter = 0;

/**
 * Per-connection chart session.
 *
 * In DeepChart Free (Chart Only), connections receive market data, footprint, profile,
 * VWAP and tape updates. Trading accounts, orders and prop firm risk engines are not part
 * of this edition.
 */
export type SessionMode = 'LIVE' | 'REPLAY' | 'REPLAY_PAUSED' | 'REPLAY_ENDED';

export interface IReplaySession {
  dispose(): void;
  start(speed?: number): void;
  pause(): void;
  step(): void;
  seek(target: number): void;
  setSpeed(speed: number): void;
  rebuildState(): void;
}

export class ChartSession {
  public readonly id = `s${++sessionCounter}`;
  public readonly createdAt = Date.now();
  public subscribedSymbol = 'BTCUSDT';
  public subscribedTimeframe = '1m';
  public subscriptionGeneration = 0;
  public replaySession: IReplaySession | null = null;
  public mode: SessionMode = 'LIVE';
  public user: User | null = null;
  public isAuthenticated = false;

  private messageTimestamps: number[] = [];

  constructor(private readonly socket: WebSocket) {}

  public setUser(user: User): void {
    this.user = user;
    this.isAuthenticated = true;
  }

  public nextGeneration(): number {
    return ++this.subscriptionGeneration;
  }

  public isReplay(): boolean {
    return (
      this.mode === 'REPLAY' ||
      this.mode === 'REPLAY_PAUSED' ||
      this.mode === 'REPLAY_ENDED' ||
      this.replaySession !== null
    );
  }

  public setMode(mode: SessionMode): void {
    this.mode = mode;
  }

  public get isOpen(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }

  /** Send a message to this session's client only. */
  public send(msg: WSServerMessage): void {
    if (!this.isOpen) return;
    // Backpressure protection: disconnect abnormally slow clients to prevent server memory bloat
    const maxBuffered = parseInt(process.env.MAX_BUFFERED_BYTES || '16777216', 10);
    if (this.socket.bufferedAmount > maxBuffered) {
      console.warn(`[ChartSession] Client ${this.id} buffer overflow (${this.socket.bufferedAmount} bytes). Disconnecting.`);
      this.socket.close(1008, 'Client buffer overflow');
      return;
    }
    this.socket.send(JSON.stringify(msg));
  }

  /** Close this session with a code and reason. */
  public close(code = 1000, reason = 'Normal closure'): void {
    if (this.isOpen) {
      this.socket.close(code, reason);
    }
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
export const MAX_SESSIONS_PER_USER = parseInt(process.env.MAX_SESSIONS_PER_USER || '3', 10);


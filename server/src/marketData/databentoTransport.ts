import { createHash } from 'crypto';
import net from 'net';
import { MarketDepthEvent, MarketTrade } from './types.js';

export const DBN_CONSTANTS = {
  MAGIC: 'DBN',
  UNDEF_PRICE: 9223372036854775807n,
  UNDEF_ORDER_SIZE: 4294967295,
  HEADER_SIZE: 16,
  TRADE_MSG_SIZE: 48,
  MBP1_MSG_SIZE: 80,
  MBP10_MSG_SIZE: 368,
  RTYPE_MBP0: 0x00, // Trades schema
  RTYPE_MBP1: 0x01, // mbp-1 schema
  RTYPE_MBP10: 0x02, // mbp-10 schema
  RTYPE_OHLCV_DEPRECATED: 0x11,
  RTYPE_OHLCV_1S: 0x20,
  RTYPE_OHLCV_1M: 0x21,
  RTYPE_OHLCV_1H: 0x22,
  RTYPE_OHLCV_1D: 0x23,
  RTYPE_ERROR: 0x19,
  RTYPE_SYMBOL_MAPPING: 0x1a,
  RTYPE_SYSTEM: 0x1b,
} as const;

export interface DatabentoConfig {
  apiKey: string;
  dataset?: string;
  symbols: string;
  stypeIn?: string;
  host?: string;
  port?: number;
  snapshot?: boolean;
}

export interface DatabentoTransportHandlers {
  onTrade: (trade: MarketTrade) => void;
  onDepth: (depth: MarketDepthEvent) => void;
  onStatus: (state: 'CONNECTING' | 'LIVE' | 'UNAVAILABLE', reason?: string) => void;
  onError: (err: Error) => void;
}

export interface DatabentoSocketLike {
  write(data: string | Uint8Array): boolean;
  on(event: 'connect' | 'data' | 'error' | 'close', listener: (...args: any[]) => void): this;
  destroy(): void;
  removeAllListeners(): this;
}

export type DatabentoSocketFactory = (host: string, port: number) => DatabentoSocketLike;

/**
 * Computes CRAM-SHA256 challenge response according to Databento Live gateway protocol:
 * response = sha256(challenge + "|" + apiKey) + "-" + last5CharsOfApiKey
 */
export function buildCramAuthResponse(challenge: string, apiKey: string, dataset: string): string {
  const bucketId = apiKey.slice(-5);
  const sha = createHash('sha256')
    .update(`${challenge}|${apiKey}`)
    .digest('hex');
  const auth = `${sha}-${bucketId}`;
  return `auth=${auth}|dataset=${dataset}|encoding=dbn|ts_out=0|compression=none|client=DeepChart/1.0.0\n`;
}

export interface ParsedDbnRecord {
  rtype: number;
  publisherId: number;
  instrumentId: number;
  tsMs: number;
  trade?: MarketTrade;
  depth?: MarketDepthEvent;
  error?: string;
}

/**
 * Parses a single binary DBN record from a buffer starting at offset 0.
 * Record length is encoded in the first byte as count of 32-bit (4-byte) words.
 */
export function parseDbnRecord(
  buffer: Buffer,
  activeSymbol: string,
  sourceProvider = 'databento'
): { parsed: ParsedDbnRecord | null; recLen: number } {
  if (buffer.length < DBN_CONSTANTS.HEADER_SIZE) {
    return { parsed: null, recLen: 0 };
  }

  const lengthWords = buffer[0];
  const recLen = lengthWords * 4;
  if (recLen < DBN_CONSTANTS.HEADER_SIZE || buffer.length < recLen) {
    return { parsed: null, recLen };
  }

  const rtype = buffer[1];
  const publisherId = buffer.readUInt16LE(2);
  const instrumentId = buffer.readUInt32LE(4);
  const tsEventNs = buffer.readBigUInt64LE(8);
  const tsMs = Math.floor(Number(tsEventNs / 1_000_000n));

  const result: ParsedDbnRecord = {
    rtype,
    publisherId,
    instrumentId,
    tsMs,
  };

  if (rtype === DBN_CONSTANTS.RTYPE_MBP0 && recLen >= DBN_CONSTANTS.TRADE_MSG_SIZE) {
    // TradeMsg (MBP-0)
    // [16..24] price (i64, 1e-9)
    // [24..28] size (u32)
    // [28] action (char: 'T' = trade)
    // [29] side (char: 'A' = Ask/Sell aggressor, 'B' = Bid/Buy aggressor, 'N' = None)
    // [30] flags (u8)
    // [31] depth (u8)
    // [32..40] ts_recv (u64)
    // [40..44] ts_in_delta (i32)
    // [44..48] sequence (u32)
    const rawPrice = buffer.readBigInt64LE(16);
    const size = buffer.readUInt32LE(24);
    const action = String.fromCharCode(buffer[28]);
    const sideChar = String.fromCharCode(buffer[29]);
    const sequence = buffer.readUInt32LE(44);

    const isValidPrice = rawPrice !== DBN_CONSTANTS.UNDEF_PRICE && rawPrice > 0n;
    const isValidSize = size !== DBN_CONSTANTS.UNDEF_ORDER_SIZE && size > 0;

    if (action === 'T' && isValidPrice && isValidSize) {
      const price = Number(rawPrice) / 1e9;
      // In Databento DBN, side indicates the aggressor side:
      // 'A' = Ask (aggressor is seller hitting bid -> SELL)
      // 'B' = Bid (aggressor is buyer lifting offer -> BUY)
      const side = sideChar === 'B' ? 'BUY' : sideChar === 'A' ? 'SELL' : 'UNKNOWN';
      result.trade = {
        ts: tsMs,
        price,
        size,
        side,
        aggressorProvenance: 'EXCHANGE_NATIVE',
        sourceProvider,
        sequenceId: sequence,
      };
    }
  } else if (rtype === DBN_CONSTANTS.RTYPE_MBP1 && recLen >= DBN_CONSTANTS.MBP1_MSG_SIZE) {
    // Mbp1Msg (MBP-1 top-of-book + optional trade)
    // [16..24] trade price (i64, 1e-9)
    // [24..28] trade size (u32)
    // [28] action (char: 'T'=trade, 'A'=add, 'C'=cancel, 'M'=modify, 'R'=reset)
    // [29] side (char)
    // [44..48] sequence (u32)
    // [48..80] levels[0] (BidAskPair, 32 bytes)
    //   [48..56] bid_px (i64, 1e-9)
    //   [56..64] ask_px (i64, 1e-9)
    //   [64..68] bid_sz (u32)
    //   [68..72] ask_sz (u32)
    //   [72..76] bid_ct (u32)
    //   [76..80] ask_ct (u32)
    const rawTradePx = buffer.readBigInt64LE(16);
    const tradeSz = buffer.readUInt32LE(24);
    const action = String.fromCharCode(buffer[28]);
    const sideChar = String.fromCharCode(buffer[29]);
    const sequence = buffer.readUInt32LE(44);

    const rawBidPx = buffer.readBigInt64LE(48);
    const rawAskPx = buffer.readBigInt64LE(56);
    const bidSz = buffer.readUInt32LE(64);
    const askSz = buffer.readUInt32LE(68);

    const hasBid =
      rawBidPx !== DBN_CONSTANTS.UNDEF_PRICE &&
      rawBidPx > 0n &&
      bidSz > 0 &&
      bidSz !== DBN_CONSTANTS.UNDEF_ORDER_SIZE;
    const hasAsk =
      rawAskPx !== DBN_CONSTANTS.UNDEF_PRICE &&
      rawAskPx > 0n &&
      askSz > 0 &&
      askSz !== DBN_CONSTANTS.UNDEF_ORDER_SIZE;

    if (hasBid || hasAsk) {
      result.depth = {
        kind: 'snapshot',
        ts: tsMs,
        bids: hasBid ? [{ price: Number(rawBidPx) / 1e9, size: bidSz }] : [],
        asks: hasAsk ? [{ price: Number(rawAskPx) / 1e9, size: askSz }] : [],
        sourceProvider,
      };
    }

    const isValidTradePx = rawTradePx !== DBN_CONSTANTS.UNDEF_PRICE && rawTradePx > 0n;
    const isValidTradeSz = tradeSz !== DBN_CONSTANTS.UNDEF_ORDER_SIZE && tradeSz > 0;

    if (action === 'T' && isValidTradePx && isValidTradeSz) {
      const side = sideChar === 'B' ? 'BUY' : sideChar === 'A' ? 'SELL' : 'UNKNOWN';
      result.trade = {
        ts: tsMs,
        price: Number(rawTradePx) / 1e9,
        size: tradeSz,
        side,
        aggressorProvenance: 'EXCHANGE_NATIVE',
        sourceProvider,
        sequenceId: sequence,
      };
    }
  } else if (rtype === DBN_CONSTANTS.RTYPE_MBP10 && recLen >= DBN_CONSTANTS.MBP10_MSG_SIZE) {
    // Mbp10Msg (10 levels of BidAskPair)
    const rawTradePx = buffer.readBigInt64LE(16);
    const tradeSz = buffer.readUInt32LE(24);
    const action = String.fromCharCode(buffer[28]);
    const sideChar = String.fromCharCode(buffer[29]);
    const sequence = buffer.readUInt32LE(44);

    const bids: { price: number; size: number }[] = [];
    const asks: { price: number; size: number }[] = [];

    for (let i = 0; i < 10; i++) {
      const offset = 48 + i * 32;
      const bPx = buffer.readBigInt64LE(offset);
      const aPx = buffer.readBigInt64LE(offset + 8);
      const bSz = buffer.readUInt32LE(offset + 16);
      const aSz = buffer.readUInt32LE(offset + 20);

      if (bPx !== DBN_CONSTANTS.UNDEF_PRICE && bPx > 0n && bSz > 0 && bSz !== DBN_CONSTANTS.UNDEF_ORDER_SIZE) {
        bids.push({ price: Number(bPx) / 1e9, size: bSz });
      }
      if (aPx !== DBN_CONSTANTS.UNDEF_PRICE && aPx > 0n && aSz > 0 && aSz !== DBN_CONSTANTS.UNDEF_ORDER_SIZE) {
        asks.push({ price: Number(aPx) / 1e9, size: aSz });
      }
    }

    if (bids.length > 0 || asks.length > 0) {
      result.depth = {
        kind: 'snapshot',
        ts: tsMs,
        bids,
        asks,
        sourceProvider,
      };
    }

    const isValidTradePx = rawTradePx !== DBN_CONSTANTS.UNDEF_PRICE && rawTradePx > 0n;
    const isValidTradeSz = tradeSz !== DBN_CONSTANTS.UNDEF_ORDER_SIZE && tradeSz > 0;

    if (action === 'T' && isValidTradePx && isValidTradeSz) {
      const side = sideChar === 'B' ? 'BUY' : sideChar === 'A' ? 'SELL' : 'UNKNOWN';
      result.trade = {
        ts: tsMs,
        price: Number(rawTradePx) / 1e9,
        size: tradeSz,
        side,
        aggressorProvenance: 'EXCHANGE_NATIVE',
        sourceProvider,
        sequenceId: sequence,
      };
    }
  } else if (rtype === DBN_CONSTANTS.RTYPE_ERROR || rtype === 0x15) {
    const errText = buffer.subarray(16, recLen).toString('utf8').replace(/\0+$/, '').trim();
    if (errText.length > 0) {
      result.error = errText;
    }
  }

  return { parsed: result, recLen };
}

export class DatabentoTransport {
  private socket: DatabentoSocketLike | null = null;
  private isDestroyed = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isConnectedFlag = false;
  private liveReported = false;
  private generation = 0;

  constructor(
    private readonly config: DatabentoConfig,
    private readonly handlers: DatabentoTransportHandlers,
    private readonly socketFactory?: DatabentoSocketFactory
  ) {}

  public isConnected(): boolean {
    return this.isConnectedFlag;
  }

  public connect(): void {
    if (this.isDestroyed) return;
    this.cleanupSocket();

    const currentGen = ++this.generation;
    const dataset = this.config.dataset || 'GLBX.MDP3';
    const subdomain = dataset.toLowerCase().replace(/\./g, '-');
    const host = this.config.host || `${subdomain}.lsg.databento.com`;
    const port = this.config.port || 13000;

    this.handlers.onStatus('CONNECTING', `connecting to Databento ${dataset} (${this.config.symbols})`);

    let phase: 'cram' | 'auth' | 'dbn_header' | 'records' = 'cram';
    let buffer = Buffer.alloc(0);

    const socket = this.socketFactory
      ? this.socketFactory(host, port)
      : (net.createConnection({ host, port }) as DatabentoSocketLike);
    this.socket = socket;

    socket.on('connect', () => {
      if (this.generation !== currentGen) return;
      this.isConnectedFlag = true;
    });

    socket.on('data', (chunk: Buffer | Uint8Array) => {
      if (this.generation !== currentGen) return;
      const bufChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      buffer = Buffer.concat([buffer, bufChunk]);

      // Phase 1: CRAM Challenge
      while (phase === 'cram') {
        const nlIdx = buffer.indexOf(10); // '\n'
        if (nlIdx === -1) break;
        const line = buffer.subarray(0, nlIdx).toString('utf8');
        buffer = buffer.subarray(nlIdx + 1);
        const match = line.match(/cram=([^\r\n|]+)/);
        if (match) {
          const challenge = match[1];
          const authReq = buildCramAuthResponse(challenge, this.config.apiKey, dataset);
          socket.write(authReq);
          phase = 'auth';
          break;
        }
      }

      // Phase 2: Auth Response
      while (phase === 'auth') {
        const nlIdx = buffer.indexOf(10);
        if (nlIdx === -1) break;
        const line = buffer.subarray(0, nlIdx).toString('utf8');
        buffer = buffer.subarray(nlIdx + 1);
        if (line.includes('success=1')) {
          let stypeIn = this.config.stypeIn || 'continuous';
          if (this.config.symbols.includes('.c.') || this.config.symbols.includes('.v.')) {
            stypeIn = 'continuous';
          } else if (this.config.symbols.endsWith('.FUT')) {
            stypeIn = 'parent';
          }
          const subTrades = `schema=trades|stype_in=${stypeIn}|symbols=${this.config.symbols}|snapshot=0|is_last=0\n`;
          const subMbp = `schema=mbp-1|stype_in=${stypeIn}|symbols=${this.config.symbols}|snapshot=0|is_last=1\n`;
          const startSession = 'start_session=1\n';

          socket.write(subTrades);
          socket.write(subMbp);
          socket.write(startSession);

          phase = 'dbn_header';
          break;
        } else if (line.includes('success=0')) {
          const errMatch = line.match(/error=([^\r\n|]+)/);
          const errMsg = errMatch ? errMatch[1] : 'Authentication failed';
          this.handlers.onError(new Error(`[Databento] Auth failure: ${errMsg}`));
          this.handlers.onStatus('UNAVAILABLE', `Databento auth failed: ${errMsg}`);
          this.disconnect();
          return;
        }
      }

      // Phase 3: DBN Metadata Header
      if (phase === 'dbn_header') {
        // DBN prefix: 3 bytes 'DBN', 1 byte version, 4 bytes uint32 LE metadata length
        if (buffer.length >= 8 && buffer.subarray(0, 3).toString('ascii') === DBN_CONSTANTS.MAGIC) {
          const metaLen = buffer.readUInt32LE(4);
          if (buffer.length >= 8 + metaLen) {
            buffer = buffer.subarray(8 + metaLen);
            phase = 'records';
          }
        } else if (buffer.length >= 8 && buffer.subarray(0, 3).toString('ascii') !== DBN_CONSTANTS.MAGIC) {
          // If first bytes don't match DBN prefix, fall back to records parsing once buffer is primed
          if (buffer.length >= 128) {
            phase = 'records';
          }
        }
      }

      // Phase 4: Streaming Records
      if (phase === 'records') {
        while (buffer.length >= DBN_CONSTANTS.HEADER_SIZE) {
          const { parsed, recLen } = parseDbnRecord(buffer, this.config.symbols);
          if (recLen === 0 || recLen < DBN_CONSTANTS.HEADER_SIZE) {
            buffer = buffer.subarray(1);
            continue;
          }
          if (buffer.length < recLen) {
            break; // Wait for full record
          }

          if (parsed) {
            if (parsed.error) {
              this.handlers.onError(new Error(`[Databento] ${parsed.error}`));
            }

            if (parsed.depth) {
              if (!this.liveReported) {
                this.liveReported = true;
                this.handlers.onStatus('LIVE', `databento ${dataset} (${this.config.symbols})`);
              }
              this.handlers.onDepth(parsed.depth);
            }

            if (parsed.trade) {
              if (!this.liveReported) {
                this.liveReported = true;
                this.handlers.onStatus('LIVE', `databento ${dataset} (${this.config.symbols})`);
              }
              this.handlers.onTrade(parsed.trade);
            }
          }

          buffer = buffer.subarray(recLen);
        }
      }
    });

    socket.on('error', (err: Error) => {
      if (this.generation !== currentGen) return;
      this.handlers.onError(err);
    });

    socket.on('close', () => {
      if (this.generation !== currentGen) return;
      this.isConnectedFlag = false;
      this.liveReported = false;
      if (!this.isDestroyed) {
        this.handlers.onStatus('UNAVAILABLE', 'Databento socket closed, reconnecting in 3s');
        this.reconnectTimer = setTimeout(() => this.connect(), 3000);
      }
    });
  }

  public disconnect(): void {
    this.isDestroyed = true;
    this.generation++;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanupSocket();
    this.isConnectedFlag = false;
    this.liveReported = false;
    this.handlers.onStatus('UNAVAILABLE', 'disconnected');
  }

  private cleanupSocket(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
  }
}

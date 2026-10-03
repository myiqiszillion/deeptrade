/**
 * Databento Live Realtime Client.
 *
 * Communicates with Databento's Live Streaming Gateway (LSG) over raw TCP
 * with CRAM-SHA256 authentication and binary DBN record decoding.
 * Also supports mock WebSocket injection for hermetic unit testing.
 */

import net from 'net';
import { createHash } from 'crypto';
import WebSocket from 'ws';
import {
  FeedHandlers,
  MarketDataFeed,
  MarketDepthEvent,
  MarketTrade,
} from '../marketData/types.js';
import {
  normalizeTrade,
  normalizeQuote,
} from './normalizer.js';
import { DbTradeRecord, DbMbp1Record } from './types.js';
import { resolveDatabentoConfig } from './config.js';

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
  RTYPE_ERROR: 0x19,
  RTYPE_SYMBOL_MAPPING: 0x1a,
  RTYPE_SYSTEM: 0x1b,
} as const;

export interface ParsedDbnRecord {
  rtype: number;
  publisherId: number;
  instrumentId: number;
  tsMs: number;
  trade?: MarketTrade;
  depth?: MarketDepthEvent;
  error?: string;
}

export function buildCramAuthResponse(challenge: string, apiKey: string, dataset: string): string {
  const bucketId = apiKey.slice(-5);
  const sha = createHash('sha256')
    .update(`${challenge}|${apiKey}`)
    .digest('hex');
  const auth = `${sha}-${bucketId}`;
  return `auth=${auth}|dataset=${dataset}|encoding=dbn|ts_out=0|compression=none|client=DeepChart/1.0.0\n`;
}

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
    const rawPrice = buffer.readBigInt64LE(16);
    const size = buffer.readUInt32LE(24);
    const action = String.fromCharCode(buffer[28]);
    const sideChar = String.fromCharCode(buffer[29]);
    const sequence = buffer.readUInt32LE(44);

    const isValidPrice = rawPrice !== DBN_CONSTANTS.UNDEF_PRICE && rawPrice > 0n;
    const isValidSize = size !== DBN_CONSTANTS.UNDEF_ORDER_SIZE && size > 0;

    if (action === 'T' && isValidPrice && isValidSize) {
      const side = sideChar === 'B' ? 'BUY' : sideChar === 'A' ? 'SELL' : 'UNKNOWN';
      result.trade = {
        ts: tsMs,
        price: Number(rawPrice) / 1e9,
        size,
        side,
        aggressorProvenance: 'EXCHANGE_NATIVE',
        sourceProvider,
        sequenceId: sequence,
      };
    }
  } else if (rtype === DBN_CONSTANTS.RTYPE_MBP1 && recLen >= DBN_CONSTANTS.MBP1_MSG_SIZE) {
    const rawTradePx = buffer.readBigInt64LE(16);
    const tradeSz = buffer.readUInt32LE(24);
    const action = String.fromCharCode(buffer[28]);
    const sideChar = String.fromCharCode(buffer[29]);
    const sequence = buffer.readUInt32LE(44);

    const bids: Array<{ price: number; size: number }> = [];
    const asks: Array<{ price: number; size: number }> = [];

    const bPx = buffer.readBigInt64LE(48);
    const aPx = buffer.readBigInt64LE(56);
    const bSz = buffer.readUInt32LE(64);
    const aSz = buffer.readUInt32LE(68);

    if (bPx !== DBN_CONSTANTS.UNDEF_PRICE && bPx > 0n && bSz > 0 && bSz !== DBN_CONSTANTS.UNDEF_ORDER_SIZE) {
      bids.push({ price: Number(bPx) / 1e9, size: bSz });
    }
    if (aPx !== DBN_CONSTANTS.UNDEF_PRICE && aPx > 0n && aSz > 0 && aSz !== DBN_CONSTANTS.UNDEF_ORDER_SIZE) {
      asks.push({ price: Number(aPx) / 1e9, size: aSz });
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

export interface DatabentoLiveOptions {
  symbol: string;
  dataset?: string;
  schema?: 'trades' | 'mbp-1';
  apiKey?: string;
  gatewayUrl?: string;
  handlers: FeedHandlers;
  WebSocketClass?: any;
}

export class DatabentoLiveClient implements MarketDataFeed {
  public readonly provider = 'databento';
  public readonly symbol: string;
  private readonly dataset: string;
  private readonly schema: 'trades' | 'mbp-1';
  private readonly apiKey: string;
  private readonly gatewayUrl: string;
  private readonly handlers: FeedHandlers;
  private readonly WSClass?: any;

  private socket: net.Socket | null = null;
  private ws: any = null;
  private connected = false;
  private intentionallyClosed = false;
  private reconnectAttempts = 0;
  private reconnectTimer: any = null;
  private liveResolver?: () => void;
  private liveRejecter?: (err: Error) => void;
  private generation = 0;

  constructor(options: DatabentoLiveOptions) {
    this.symbol = options.symbol;
    this.dataset = options.dataset || this.inferDataset(options.symbol);
    const cfg = resolveDatabentoConfig();
    this.schema = options.schema || 'mbp-1';
    this.apiKey = options.apiKey || cfg.apiKey || (process.env.DATABENTO_API_KEY || '');
    this.gatewayUrl = (options.gatewayUrl || cfg.liveBaseUrl || 'wss://live.databento.com/v0').replace(/\/+$/, '');
    this.handlers = options.handlers;
    this.WSClass = options.WebSocketClass;
  }

  private inferDataset(symbol: string): string {
    const s = symbol.toUpperCase();
    if (s.includes('.OPT') || s.match(/^[A-Z]{1,6}\d{6}[CP]\d{8}$/)) return 'OPRA.PILLAR';
    const cfg = resolveDatabentoConfig();
    if (['ES','NQ','MES','MNQ','CL','GC','ZB','ZN','UB','RTY','MGC','SI','HG'].includes(s) || s.startsWith('ES.') || s.startsWith('NQ.')) return cfg.cmeDataset;
    return cfg.equitiesDataset;
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public async connect(): Promise<void> {
    if (this.connected || this.socket || this.ws) return;
    if (!this.apiKey) {
      this.handlers.onStatus({
        state: 'UNAVAILABLE',
        reason: 'Missing Databento API key (DATABENTO_API_KEY)',
        provider: this.provider,
        symbol: this.symbol,
      });
      return;
    }

    this.intentionallyClosed = false;
    this.handlers.onStatus({
      state: 'CONNECTING',
      reason: `Connecting to Databento Live (${this.dataset}:${this.symbol})...`,
      provider: this.provider,
      symbol: this.symbol,
    });

    if (this.WSClass) {
      this.connectWebSocket();
    } else {
      this.connectTcp();
    }
  }

  private connectWebSocket(): void {
    const url = `${this.gatewayUrl}?api_key=${encodeURIComponent(this.apiKey)}&dataset=${encodeURIComponent(this.dataset)}&symbols=${encodeURIComponent(this.symbol)}&schema=${encodeURIComponent(this.schema)}&encoding=json`;

    try {
      const headers: Record<string, string> = {
        Authorization: 'Basic ' + Buffer.from(`${this.apiKey}:`).toString('base64'),
      };
      this.ws = new this.WSClass(url, { headers });

      this.ws.on('open', () => {
        this.reconnectAttempts = 0;
        this.connected = true;
        this.handlers.onStatus({
          state: 'LIVE',
          reason: 'Connected to Databento realtime stream',
          provider: this.provider,
          symbol: this.symbol,
        });
        if (this.liveResolver) {
          this.liveResolver();
          this.liveResolver = undefined;
          this.liveRejecter = undefined;
        }
      });

      this.ws.on('message', (data: any) => {
        try {
          const raw = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
          const parsed = JSON.parse(raw);
          this.dispatchWsRecord(parsed);
        } catch {
          // ignore corrupted frame
        }
      });

      this.ws.on('error', (err: any) => {
        const msg = err?.message || String(err);
        console.warn(`[DatabentoLive:${this.symbol}] WebSocket error: ${msg}`);
        this.handlers.onError(err instanceof Error ? err : new Error(msg));
      });

      this.ws.on('close', (code: number, reason: any) => {
        this.connected = false;
        this.ws = null;
        if (!this.intentionallyClosed) {
          this.handlers.onStatus({
            state: 'UNAVAILABLE',
            reason: `closed code=${code} reason=${reason || '(empty)'}`,
            provider: this.provider,
            symbol: this.symbol,
          });
          this.scheduleReconnect();
        }
      });
    } catch (err: any) {
      this.handlers.onError(err instanceof Error ? err : new Error(String(err)));
      this.scheduleReconnect();
    }
  }

  private dispatchWsRecord(parsed: any): void {
    if (!parsed || typeof parsed !== 'object') return;
    if (parsed.status === 'error' || parsed.error) {
      this.handlers.onError(new Error(parsed.message || parsed.error));
      return;
    }
    if (parsed.action === 'T' || parsed.schema === 'trades' || parsed.rtype === 2) {
      try {
        const norm = normalizeTrade(parsed as DbTradeRecord);
        const mt: MarketTrade = {
          ts: norm.timestamp,
          price: norm.price,
          size: norm.size,
          side: norm.side === 'buy' ? 'BUY' : norm.side === 'sell' ? 'SELL' : 'UNKNOWN',
          id: norm.tradeId,
          receiveTs: Date.now(),
          aggressorProvenance: 'EXCHANGE_NATIVE',
          sourceProvider: this.provider,
        };
        this.handlers.onTrade(mt);
      } catch (e: any) {
        console.warn(`[DatabentoLive:${this.symbol}] trade normalize failed: ${e?.message}`);
      }
      return;
    }
    if (parsed.bid_px_00 !== undefined || parsed.ask_px_00 !== undefined || parsed.rtype === 3) {
      try {
        const norm = normalizeQuote(parsed as DbMbp1Record);
        const ev: MarketDepthEvent = {
          kind: 'snapshot',
          ts: norm.timestamp,
          bids: norm.bidPrice > 0 ? [{ price: norm.bidPrice, size: norm.bidSize }] : [],
          asks: norm.askPrice > 0 ? [{ price: norm.askPrice, size: norm.askSize }] : [],
          receiveTs: Date.now(),
          sourceProvider: this.provider,
        };
        this.handlers.onDepth(ev);
      } catch (e: any) {
        console.warn(`[DatabentoLive:${this.symbol}] quote normalize failed: ${e?.message}`);
      }
      return;
    }
  }

  private connectTcp(): void {
    const currentGen = ++this.generation;
    const dataset = this.dataset;
    const subdomain = dataset.toLowerCase().replace(/\./g, '-');
    const host = `${subdomain}.lsg.databento.com`;
    const port = 13000;

    let phase: 'cram' | 'auth' | 'dbn_header' | 'records' = 'cram';
    let buffer = Buffer.alloc(0);

    const socket = net.createConnection({ host, port });
    this.socket = socket;

    socket.on('connect', () => {
      if (this.generation !== currentGen) return;
    });

    socket.on('data', (chunk: Buffer) => {
      if (this.generation !== currentGen) return;
      buffer = Buffer.concat([buffer, chunk]);

      // Phase 1: CRAM Challenge
      while (phase === 'cram') {
        const nlIdx = buffer.indexOf(10);
        if (nlIdx === -1) break;
        const line = buffer.subarray(0, nlIdx).toString('utf8');
        buffer = buffer.subarray(nlIdx + 1);
        const match = line.match(/cram=([^\r\n|]+)/);
        if (match) {
          const challenge = match[1];
          const authReq = buildCramAuthResponse(challenge, this.apiKey, dataset);
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
          this.reconnectAttempts = 0;
          this.connected = true;
          this.handlers.onStatus({
            state: 'LIVE',
            reason: `Connected to Databento realtime stream (${dataset}:${this.symbol})`,
            provider: this.provider,
            symbol: this.symbol,
          });
          if (this.liveResolver) {
            this.liveResolver();
            this.liveResolver = undefined;
            this.liveRejecter = undefined;
          }

          const liveSymbol = this.symbol.includes('.') ? this.symbol : `${this.symbol}.c.0`;
          let stypeIn = 'continuous';
          if (liveSymbol.endsWith('.FUT')) {
            stypeIn = 'parent';
          } else if (!liveSymbol.includes('.c.') && !liveSymbol.includes('.v.')) {
            stypeIn = 'raw_symbol';
          }

          const subTrades = `schema=trades|stype_in=${stypeIn}|symbols=${liveSymbol}|snapshot=0|is_last=0\n`;
          const subMbp = `schema=mbp-1|stype_in=${stypeIn}|symbols=${liveSymbol}|snapshot=0|is_last=1\n`;
          const startSession = 'start_session=1\n';

          socket.write(subTrades);
          socket.write(subMbp);
          socket.write(startSession);

          phase = 'dbn_header';
          break;
        } else if (line.includes('success=0')) {
          const errMatch = line.match(/error=([^\r\n|]+)/);
          const errMsg = errMatch ? errMatch[1] : 'Authentication failed';
          this.handlers.onError(new Error(`[DatabentoLive:${this.symbol}] Auth failure: ${errMsg}`));
          this.handlers.onStatus({
            state: 'UNAVAILABLE',
            reason: `Databento auth failed: ${errMsg}`,
            provider: this.provider,
            symbol: this.symbol,
          });
          this.disconnect();
          return;
        }
      }

      // Phase 3: DBN Header
      if (phase === 'dbn_header') {
        if (buffer.length >= 8 && buffer.subarray(0, 3).toString('ascii') === DBN_CONSTANTS.MAGIC) {
          const metaLen = buffer.readUInt32LE(4);
          if (buffer.length >= 8 + metaLen) {
            buffer = buffer.subarray(8 + metaLen);
            phase = 'records';
          }
        } else if (buffer.length >= 128 && buffer.subarray(0, 3).toString('ascii') !== DBN_CONSTANTS.MAGIC) {
          phase = 'records';
        }
      }

      // Phase 4: Records
      if (phase === 'records') {
        while (buffer.length >= DBN_CONSTANTS.HEADER_SIZE) {
          const { parsed, recLen } = parseDbnRecord(buffer, this.symbol, this.provider);
          if (recLen === 0 || recLen < DBN_CONSTANTS.HEADER_SIZE) {
            buffer = buffer.subarray(1);
            continue;
          }
          if (buffer.length < recLen) {
            break;
          }

          if (parsed) {
            if (parsed.error) {
              this.handlers.onError(new Error(`[DatabentoLive:${this.symbol}] ${parsed.error}`));
            }
            if (parsed.depth) {
              this.handlers.onDepth(parsed.depth);
            }
            if (parsed.trade) {
              this.handlers.onTrade(parsed.trade);
            }
          }

          buffer = buffer.subarray(recLen);
        }
      }
    });

    socket.on('error', (err: Error) => {
      if (this.generation !== currentGen) return;
      console.warn(`[DatabentoLive:${this.symbol}] TCP error: ${err.message}`);
      this.handlers.onError(err);
    });

    socket.on('close', () => {
      if (this.generation !== currentGen) return;
      this.connected = false;
      this.socket = null;
      if (!this.intentionallyClosed) {
        this.handlers.onStatus({
          state: 'UNAVAILABLE',
          reason: 'Databento TCP socket closed, reconnecting...',
          provider: this.provider,
          symbol: this.symbol,
        });
        this.scheduleReconnect();
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.intentionallyClosed) return;
    this.reconnectAttempts++;
    const delay = Math.min(30000, 1000 * Math.pow(2, Math.min(5, this.reconnectAttempts)));
    console.log(`[DatabentoLive:${this.symbol}] reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((err) =>
        this.handlers.onError(err instanceof Error ? err : new Error(String(err)))
      );
    }, delay);
    if (this.reconnectTimer.unref) this.reconnectTimer.unref();
  }

  public async disconnect(): Promise<void> {
    this.intentionallyClosed = true;
    this.generation++;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.connected = false;
  }

  public waitForLive(timeoutMs = 8000): Promise<void> {
    if (this.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.liveResolver = undefined;
        this.liveRejecter = undefined;
        reject(new Error(`Timed out waiting for Databento live stream for ${this.symbol} (${timeoutMs}ms)`));
      }, timeoutMs);
      this.liveResolver = () => {
        clearTimeout(timer);
        resolve();
      };
      this.liveRejecter = (err) => {
        clearTimeout(timer);
        reject(err);
      };
    });
  }
}

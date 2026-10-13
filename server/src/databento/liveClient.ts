/**
 * Databento Live Realtime Client.
 *
 * Communicates with Databento's Live Streaming Gateway (LSG) over raw TCP
 * with CRAM-SHA256 authentication and binary DBN record decoding.
 * Also supports mock WebSocket injection for hermetic unit testing.
 */

import net from 'net';
import { createHash } from 'crypto';
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
  SYSTEM_MSG_SIZE: 320,
  ERROR_MSG_SIZE: 320,
  RTYPE_MBP0: 0x00, // Trades schema (MBP-0, 48 bytes)
  RTYPE_MBP1: 0x01, // mbp-1 schema (Mbp1Msg, 80 bytes)
  RTYPE_TBBO: 0x01, // tbbo schema (uses Mbp1Msg layout with rtype 0x01 per official Databento spec, 80 bytes)
  RTYPE_MBP10: 0x0A, // mbp-10 schema (10 levels book depth, 368 bytes - Databento official spec)
  RTYPE_ERROR: 0x15, // ErrorMsg (official Databento DBN enum: 21 decimal)
  RTYPE_SYMBOL_MAPPING: 0x16, // SymbolMappingMsg (official Databento DBN enum: 22 decimal)
  RTYPE_SYSTEM: 0x17, // SystemMsg (official Databento DBN enum: 23 decimal)
  RTYPE_STATISTICS: 0x18, // StatisticsMsg (official Databento DBN enum: 24 decimal)
} as const;

export const SYSTEM_CODES = {
  HEARTBEAT: 0,
  SUBSCRIPTION_ACK: 1,
  SLOW_READER_WARNING: 2,
  REPLAY_COMPLETED: 3,
} as const;

export interface ParsedDbnRecord {
  rtype: number;
  publisherId: number;
  instrumentId: number;
  tsMs: number;
  schema?: 'trades' | 'mbp-1' | 'mbp-10' | 'tbbo' | string;
  trade?: MarketTrade;
  depth?: MarketDepthEvent;
  error?: string;
  errorCode?: number;
  isLast?: number;
  system?: {
    code: number;
    msg: string;
    isHeartbeat: boolean;
    isSubscriptionAck: boolean;
  };
}

function buildCramAuthResponse(challenge: string, apiKey: string, dataset: string): string {
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
  sourceProvider = 'databento',
  dbnVersion = 2,
  context?: { schema?: 'trades' | 'mbp-1' | 'mbp-10' | 'tbbo' | string; [key: string]: any }
): { parsed: ParsedDbnRecord | null; recLen: number } {
  if (buffer.length < DBN_CONSTANTS.HEADER_SIZE) {
    return { parsed: null, recLen: 0 };
  }

  // Guard against interpreting stream metadata framing ('DBN' magic) as record or subscription ACK
  if (buffer.length >= 3 && buffer[0] === 0x44 && buffer[1] === 0x42 && buffer[2] === 0x4E) {
    return { parsed: null, recLen: 0 };
  }

  const lengthWords = buffer[0];
  const recLen = lengthWords * 4;
  if (recLen < DBN_CONSTANTS.HEADER_SIZE || recLen > 1024) {
    return { parsed: null, recLen: 0 };
  }
  if (buffer.length < recLen) {
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
    result.schema = 'trades';
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
  } else if ((rtype === DBN_CONSTANTS.RTYPE_MBP1 || rtype === DBN_CONSTANTS.RTYPE_TBBO) && recLen >= DBN_CONSTANTS.MBP1_MSG_SIZE) {
    // Both mbp-1 and tbbo schemas emit Mbp1Msg with literal rtype = 0x01.
    // Disambiguate schema by metadata or subscription context, defaulting to 'mbp-1'.
    result.schema = context?.schema === 'tbbo' ? 'tbbo' : (context?.schema || 'mbp-1');
    const rawTradePx = buffer.readBigInt64LE(16);
    const tradeSz = buffer.readUInt32LE(24);
    const action = String.fromCharCode(buffer[28]);
    const sideChar = String.fromCharCode(buffer[29]);
    const sequence = buffer.readUInt32LE(44);

    const bids: Array<{ price: number; size: number; count?: number }> = [];
    const asks: Array<{ price: number; size: number; count?: number }> = [];

    const bPx = buffer.readBigInt64LE(48);
    const aPx = buffer.readBigInt64LE(56);
    const bSz = buffer.readUInt32LE(64);
    const aSz = buffer.readUInt32LE(68);
    const bCt = buffer.readUInt32LE(72);
    const aCt = buffer.readUInt32LE(76);

    if (bPx !== DBN_CONSTANTS.UNDEF_PRICE && bPx > 0n && bSz > 0 && bSz !== DBN_CONSTANTS.UNDEF_ORDER_SIZE) {
      bids.push({
        price: Number(bPx) / 1e9,
        size: bSz,
        count: bCt !== DBN_CONSTANTS.UNDEF_ORDER_SIZE ? bCt : undefined,
      });
    }
    if (aPx !== DBN_CONSTANTS.UNDEF_PRICE && aPx > 0n && aSz > 0 && aSz !== DBN_CONSTANTS.UNDEF_ORDER_SIZE) {
      asks.push({
        price: Number(aPx) / 1e9,
        size: aSz,
        count: aCt !== DBN_CONSTANTS.UNDEF_ORDER_SIZE ? aCt : undefined,
      });
    }

    if (bids.length > 0 || asks.length > 0) {
      result.depth = {
        kind: 'snapshot',
        ts: tsMs,
        bids,
        asks,
        sourceProvider,
        updateId: sequence > 0 ? sequence : undefined,
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
    result.schema = 'mbp-10';
    const rawTradePx = buffer.readBigInt64LE(16);
    const tradeSz = buffer.readUInt32LE(24);
    const action = String.fromCharCode(buffer[28]);
    const sideChar = String.fromCharCode(buffer[29]);
    const sequence = buffer.readUInt32LE(44);

    const bids: Array<{ price: number; size: number; count?: number }> = [];
    const asks: Array<{ price: number; size: number; count?: number }> = [];

    for (let i = 0; i < 10; i++) {
      const lvlOffset = 48 + i * 32;
      const bPx = buffer.readBigInt64LE(lvlOffset + 0);
      const aPx = buffer.readBigInt64LE(lvlOffset + 8);
      const bSz = buffer.readUInt32LE(lvlOffset + 16);
      const aSz = buffer.readUInt32LE(lvlOffset + 20);
      const bCt = buffer.readUInt32LE(lvlOffset + 24);
      const aCt = buffer.readUInt32LE(lvlOffset + 28);

      if (bPx !== DBN_CONSTANTS.UNDEF_PRICE && bPx > 0n && bSz > 0 && bSz !== DBN_CONSTANTS.UNDEF_ORDER_SIZE) {
        bids.push({
          price: Number(bPx) / 1e9,
          size: bSz,
          count: bCt !== DBN_CONSTANTS.UNDEF_ORDER_SIZE ? bCt : undefined,
        });
      }
      if (aPx !== DBN_CONSTANTS.UNDEF_PRICE && aPx > 0n && aSz > 0 && aSz !== DBN_CONSTANTS.UNDEF_ORDER_SIZE) {
        asks.push({
          price: Number(aPx) / 1e9,
          size: aSz,
          count: aCt !== DBN_CONSTANTS.UNDEF_ORDER_SIZE ? aCt : undefined,
        });
      }
    }

    if (bids.length > 0 || asks.length > 0) {
      result.depth = {
        kind: 'snapshot',
        ts: tsMs,
        bids,
        asks,
        sourceProvider,
        updateId: sequence > 0 ? sequence : undefined,
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
  } else if (rtype === DBN_CONSTANTS.RTYPE_SYSTEM) {
    let code = 0;
    let msg = '';
    if (dbnVersion >= 2 && recLen >= DBN_CONSTANTS.SYSTEM_MSG_SIZE) {
      // DBN v2+: msg[303] (bytes 16..318), code uint8 at byte 319 (total 320 bytes)
      code = buffer.readUInt8(319);
      const nullIdx = buffer.subarray(16, 319).indexOf(0);
      msg = (nullIdx !== -1 ? buffer.subarray(16, 16 + nullIdx) : buffer.subarray(16, 319))
        .toString('utf8')
        .trim();
    } else {
      // DBN v1 legacy fallback: msg without explicit trailing code
      const nullIdx = buffer.subarray(16, recLen).indexOf(0);
      msg = (nullIdx !== -1 ? buffer.subarray(16, 16 + nullIdx) : buffer.subarray(16, recLen))
        .toString('utf8')
        .trim();
      const lower = msg.toLowerCase();
      if (lower.includes('subscribed') || lower.includes('subscription')) {
        code = SYSTEM_CODES.SUBSCRIPTION_ACK;
      } else if (lower.includes('heartbeat')) {
        code = SYSTEM_CODES.HEARTBEAT;
      } else if (lower.includes('slow reader')) {
        code = SYSTEM_CODES.SLOW_READER_WARNING;
      } else if (lower.includes('replay')) {
        code = SYSTEM_CODES.REPLAY_COMPLETED;
      }
    }
    result.system = {
      code,
      msg,
      isHeartbeat: code === SYSTEM_CODES.HEARTBEAT,
      isSubscriptionAck: code === SYSTEM_CODES.SUBSCRIPTION_ACK,
    };
  } else if (rtype === DBN_CONSTANTS.RTYPE_ERROR) {
    let errCode = 0;
    let isLast = 1;
    let errText = '';
    if (dbnVersion >= 2 && recLen >= DBN_CONSTANTS.ERROR_MSG_SIZE) {
      // DBN v2+: err[302] (bytes 16..317), code uint8 at byte 318, is_last uint8 at byte 319 (total 320 bytes)
      const nullIdx = buffer.subarray(16, 318).indexOf(0);
      errText = (nullIdx !== -1
        ? buffer.subarray(16, 16 + nullIdx)
        : buffer.subarray(16, 318)
      ).toString('utf8').trim();
      errCode = buffer.readUInt8(318);
      isLast = buffer.readUInt8(319);
    } else {
      // DBN v1 legacy compatibility
      const nullIdx = buffer.subarray(16, recLen).indexOf(0);
      errText = (nullIdx !== -1
        ? buffer.subarray(16, 16 + nullIdx)
        : buffer.subarray(16, recLen)
      ).toString('utf8').trim();
    }
    result.error = errText.length > 0 ? errText : 'Unknown Databento gateway error';
    result.errorCode = errCode;
    result.isLast = isLast;
  }

  return { parsed: result, recLen };
}

interface DatabentoLiveOptions {
  symbol: string;
  dataset?: string;
  schema?: 'trades' | 'mbp-1' | 'mbp-10' | 'tbbo';
  apiKey?: string;
  gatewayUrl?: string;
  handlers: FeedHandlers;
  WebSocketClass?: any;
  /** Only the private operator acceptance controller supplies these hooks. */
  acceptance?: {
    createConnection?: typeof net.createConnection;
    onStage: (stage: 'AUTHENTICATED' | 'ACKNOWLEDGED' | 'METADATA') => void;
    beforeRecord: (record: Buffer, parsed: ParsedDbnRecord | null) => boolean;
    onFailure: (reason: string) => void;
  };
}

export class DatabentoLiveClient implements MarketDataFeed {
  public readonly provider = 'databento';
  public readonly symbol: string;
  private readonly dataset: string;
  private readonly schema: 'trades' | 'mbp-1' | 'mbp-10' | 'tbbo';
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
  private generation = 0;
  private dbnVersion = 2;
  private readonly acceptance?: DatabentoLiveOptions['acceptance'];
  private acceptanceStarted = false;

  constructor(options: DatabentoLiveOptions) {
    if ((globalThis as any)[Symbol.for('deepchart.offline.guard')] && (options.apiKey || process.env.DATABENTO_API_KEY) &&
        !options.WebSocketClass && !options.acceptance?.createConnection) {
      (globalThis as any)[Symbol.for('deepchart.offline.guard')].fail('vendor factory requires injected mock transport');
    }
    this.symbol = options.symbol;
    this.dataset = options.dataset || this.inferDataset(options.symbol);
    const cfg = resolveDatabentoConfig();
    this.schema = options.schema || 'mbp-1';
    this.apiKey = options.apiKey || cfg.apiKey || (process.env.DATABENTO_API_KEY || '');
    this.gatewayUrl = (options.gatewayUrl || cfg.liveBaseUrl || 'wss://live.databento.com/v0').replace(/\/+$/, '');
    this.handlers = options.handlers;
    this.WSClass = options.WebSocketClass;
    this.acceptance = options.acceptance;
    if (this.acceptance && (this.dataset !== 'GLBX.MDP3' || this.symbol !== 'ES.c.0' || this.schema !== 'trades' || this.WSClass)) {
      throw new Error('Acceptance requires GLBX.MDP3 / ES.c.0 / trades over TCP');
    }
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
    if (this.acceptance) {
      if (this.acceptanceStarted) throw new Error('Acceptance cannot restart');
      this.acceptanceStarted = true;
    }
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

    const effectiveSchema = parsed.schema || this.schema;
    const isTradeAction = parsed.action === 'T';
    const isTradesSchema = effectiveSchema === 'trades' || parsed.rtype === DBN_CONSTANTS.RTYPE_MBP0;
    const isTbbo = effectiveSchema === 'tbbo';
    const hasTradeData = isTradeAction || isTradesSchema || (isTbbo && (parsed.price !== undefined || parsed.px !== undefined));

    if (hasTradeData) {
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
      // Pure trades schema with no depth fields finishes after emitting trade
      if (effectiveSchema === 'trades' && !parsed.bids && !parsed.asks && parsed.bid_px_00 === undefined) {
        return;
      }
    }

    const hasDepthData = parsed.bids || parsed.asks || parsed.bid_px_00 !== undefined || parsed.ask_px_00 !== undefined;
    const isDepthSchema = effectiveSchema === 'mbp-1' || effectiveSchema === 'mbp-10' || effectiveSchema === 'tbbo' ||
      parsed.rtype === DBN_CONSTANTS.RTYPE_MBP1 || parsed.rtype === DBN_CONSTANTS.RTYPE_MBP10;

    if (hasDepthData || (isDepthSchema && !hasTradeData)) {
      try {
        if (Array.isArray(parsed.bids) || Array.isArray(parsed.asks)) {
          const ev: MarketDepthEvent = {
            kind: 'snapshot',
            ts: parsed.ts || parsed.timestamp || Date.now(),
            bids: parsed.bids || [],
            asks: parsed.asks || [],
            receiveTs: Date.now(),
            sourceProvider: this.provider,
          };
          this.handlers.onDepth(ev);
        } else if (parsed.bid_px_00 !== undefined || parsed.ask_px_00 !== undefined) {
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
        }
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

    const socket = (this.acceptance?.createConnection || net.createConnection)({ host, port });
    this.socket = socket;

    socket.on('connect', () => {
      if (this.generation !== currentGen) return;
    });

    socket.on('data', (chunk: Buffer) => {
      if (this.generation !== currentGen) return;
      if (this.acceptance && buffer.length + chunk.length > 1024 * 1024) { this.acceptance.onFailure('Input buffer limit'); return; }
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
          this.acceptance?.onStage('AUTHENTICATED');
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
          }

          const liveSymbol = this.symbol.includes('.') ? this.symbol : `${this.symbol}.c.0`;
          let stypeIn = 'continuous';
          if (liveSymbol.endsWith('.FUT')) {
            stypeIn = 'parent';
          } else if (!liveSymbol.includes('.c.') && !liveSymbol.includes('.v.')) {
            stypeIn = 'raw_symbol';
          }

          if (this.acceptance) {
            socket.write('schema=trades|stype_in=continuous|symbols=ES.c.0|snapshot=0|is_last=1\n');
          } else if (this.schema === 'tbbo') {
            const subTbbo = `schema=tbbo|stype_in=${stypeIn}|symbols=${liveSymbol}|snapshot=0|is_last=1\n`;
            socket.write(subTbbo);
          } else {
            const depthSchema = this.schema === 'mbp-10' ? 'mbp-10' : 'mbp-1';
            const subTrades = `schema=trades|stype_in=${stypeIn}|symbols=${liveSymbol}|snapshot=0|is_last=0\n`;
            const subMbp = `schema=${depthSchema}|stype_in=${stypeIn}|symbols=${liveSymbol}|snapshot=0|is_last=1\n`;
            socket.write(subTrades);
            socket.write(subMbp);
          }
          const startSession = 'start_session=1\n';
          socket.write(startSession);

          phase = 'dbn_header';
          break;
        } else if (line.includes('success=0')) {
          const errMatch = line.match(/error=([^\r\n|]+)/);
          const errMsg = errMatch ? errMatch[1] : 'Authentication failed';
          this.acceptance?.onFailure('Authentication rejected');
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
          this.dbnVersion = buffer.readUInt8(3);
          const metaLen = buffer.readUInt32LE(4);
          if (buffer.length >= 8 + metaLen) {
            buffer = buffer.subarray(8 + metaLen);
            this.acceptance?.onStage('METADATA');
            phase = 'records';
          }
        } else if (buffer.length >= 128 && buffer.subarray(0, 3).toString('ascii') !== DBN_CONSTANTS.MAGIC) {
          if (this.acceptance) { this.acceptance.onFailure('Invalid metadata framing'); return; }
          phase = 'records';
        }
      }

      // Phase 4: Records
      if (phase === 'records') {
        while (buffer.length >= DBN_CONSTANTS.HEADER_SIZE) {
          if (this.acceptance && this.generation !== currentGen) return;
          const { parsed, recLen } = parseDbnRecord(buffer, this.symbol, this.provider, this.dbnVersion, {
            schema: this.schema,
          });
          if (recLen === 0 || recLen < DBN_CONSTANTS.HEADER_SIZE) {
            if (this.acceptance) { this.acceptance.onFailure('Invalid record framing'); return; }
            buffer = buffer.subarray(1);
            continue;
          }
          if (buffer.length < recLen) {
            break;
          }

          if (this.acceptance && !this.acceptance.beforeRecord(buffer.subarray(0, recLen), parsed)) return;

          if (parsed) {
            if (parsed.error) {
              if (this.acceptance) { this.acceptance.onFailure('Gateway ErrorMsg'); return; }
              this.handlers.onError(new Error(`[DatabentoLive:${this.symbol}] ${parsed.error}`));
            }
            if (parsed.system) {
              if (parsed.system.isHeartbeat) {
                // Gateway heartbeat keepalive
              } else if (parsed.system.isSubscriptionAck) {
                this.acceptance?.onStage('ACKNOWLEDGED');
                // Subscription acknowledged
              }
            }
            if (parsed.depth) {
              this.handlers.onDepth(parsed.depth);
            }
            if (parsed.trade) {
              this.handlers.onTrade(parsed.trade);
            }
            if (!parsed.trade && !parsed.depth && !parsed.system && !parsed.error) {
              // Administrative or unhandled DBN record (e.g. SymbolMapping 0x16, Statistics 0x18)
              // Telemetry: safely handled, never routed as market trade/depth
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
      this.acceptance?.onFailure('TCP error');
    });

    socket.on('close', () => {
      if (this.generation !== currentGen) return;
      this.connected = false;
      this.socket = null;
      if (!this.intentionallyClosed) {
        if (this.acceptance) { this.acceptance.onFailure('Unexpected socket close'); return; }
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
    if (this.acceptance) return;
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
        reject(new Error(`Timed out waiting for Databento live stream for ${this.symbol} (${timeoutMs}ms)`));
      }, timeoutMs);
      this.liveResolver = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
}

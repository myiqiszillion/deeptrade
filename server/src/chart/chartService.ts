/**
 * Chart Service
 *
 * Implements TradingView Universal Datafeed (UDF) handlers and Institutional
 * Order Flow analytics (Footprint, CVD, Volume Profile, VWAP, Heatmap, Levels)
 * powered directly by Databento.
 */

import { DatabentoHttpClient } from '../databento/client.js';
import { FUTURES_INSTRUMENTS } from '../futuresConfig.js';
import { FootprintEngine } from '../footprintEngine.js';
import { ProfileEngine } from '../profileEngine.js';
import { VWAPEngine } from '../vwapEngine.js';
import { HistoricalBar, Tick } from '../types.js';
import {
  parseTradingViewResolution,
  aggregateBars,
  resolveSymbolForDatabento,
} from './resolution.js';
import {
  UdfConfig,
  UdfSymbolInfo,
  UdfHistoryResponse,
  UdfMarksResponse,
  UdfTimescaleMarksResponse,
  FootprintBarResponse,
  CvdPoint,
  VolumeProfileResponse,
  VwapPointResponse,
  DepthHeatmapSnapshot,
  LargeTradePrint,
  ChartLevelsResponse,
} from './types.js';
import { marketDataStore } from '../storage/marketDataStore.js';

export class ChartService {
  private readonly client: DatabentoHttpClient;

  constructor(client: DatabentoHttpClient) {
    this.client = client;
  }

  /**
   * 1. TradingView UDF Configuration
   */
  public getUdfConfig(): UdfConfig {
    return {
      supported_resolutions: [
        '1S', '5S', '15S', '30S',
        '1', '3', '5', '15', '30',
        '60', '120', '240',
        'D', '1D', 'W', '1W', 'M', '1M',
      ],
      supports_group_request: false,
      supports_marks: true,
      supports_search: true,
      supports_time: true,
      supports_timescale_marks: true,
      symbols_types: [
        { name: 'All', value: '' },
        { name: 'Futures', value: 'futures' },
        { name: 'Stock', value: 'stock' },
        { name: 'Option', value: 'option' },
        { name: 'Index', value: 'index' },
      ],
    };
  }

  /**
   * 2. Server Time (epoch seconds)
   */
  public getUdfTime(): number {
    return Math.floor(Date.now() / 1000);
  }

  /**
   * 3. Symbol Details for TradingView
   */
  public async getUdfSymbol(rawSymbol: string): Promise<UdfSymbolInfo> {
    const sym = rawSymbol.toUpperCase().trim();
    const root = sym.split('.')[0].replace(/[0-9]+$/, '');
    const futuresSpec = FUTURES_INSTRUMENTS[sym] || FUTURES_INSTRUMENTS[root];

    if (futuresSpec) {
      const pricescale = Math.round(1 / futuresSpec.tickSize);
      return {
        name: sym,
        ticker: sym,
        description: futuresSpec.name,
        type: 'futures',
        session: '1800-1700:23456',
        exchange: futuresSpec.exchange || 'CME',
        listed_exchange: futuresSpec.exchange || 'CME',
        timezone: futuresSpec.timezone || 'America/New_York',
        minmov: 1,
        pricescale: pricescale > 0 ? pricescale : 100,
        minmove2: 0,
        fractional: false,
        has_intraday: true,
        has_seconds: true,
        has_daily: true,
        has_weekly_and_monthly: true,
        supported_resolutions: [
          '1S', '5S', '15S', '30S', '1', '3', '5', '15', '30', '60', '120', '240', '1D', '1W', '1M'
        ],
        intraday_multipliers: ['1', '3', '5', '15', '30', '60', '120', '240'],
        seconds_multipliers: ['1', '5', '15', '30'],
        currency_code: futuresSpec.currency || 'USD',
        volume_precision: 0,
      };
    }

    // Check if Option
    const isOption = sym.includes('.OPT') || sym.match(/^[A-Z]{1,6}\d{6}[CP]\d{8}$/);
    if (isOption) {
      return {
        name: sym,
        ticker: sym,
        description: `${sym} US Equity Option (OPRA)`,
        type: 'option',
        session: '0930-1600:23456',
        exchange: 'OPRA',
        listed_exchange: 'OPRA',
        timezone: 'America/New_York',
        minmov: 1,
        pricescale: 100,
        minmove2: 0,
        fractional: false,
        has_intraday: true,
        has_seconds: true,
        has_daily: true,
        has_weekly_and_monthly: true,
        supported_resolutions: ['1', '5', '15', '60', '1D'],
        intraday_multipliers: ['1', '5', '15', '60'],
        seconds_multipliers: ['1', '5'],
        currency_code: 'USD',
        volume_precision: 0,
      };
    }

    // Default: US Stock / ETF
    return {
      name: sym,
      ticker: sym,
      description: `${sym} Common Stock / ETF`,
      type: 'stock',
      session: '0930-1600:23456',
      exchange: 'NASDAQ',
      listed_exchange: 'NASDAQ',
      timezone: 'America/New_York',
      minmov: 1,
      pricescale: 100,
      minmove2: 0,
      fractional: false,
      has_intraday: true,
      has_seconds: true,
      has_daily: true,
      has_weekly_and_monthly: true,
      supported_resolutions: [
        '1S', '5S', '15S', '30S', '1', '3', '5', '15', '30', '60', '120', '240', '1D', '1W', '1M'
      ],
      intraday_multipliers: ['1', '3', '5', '15', '30', '60', '120', '240'],
      seconds_multipliers: ['1', '5', '15', '30'],
      currency_code: 'USD',
      volume_precision: 0,
    };
  }

  /**
   * 4. Symbol Search across Databento Catalog
   */
  public async searchUdfSymbols(
    query: string,
    type?: string,
    exchange?: string,
    limit = 30
  ): Promise<Array<{ symbol: string; full_name: string; description: string; exchange: string; ticker: string; type: string }>> {
    const q = (query || '').toUpperCase().trim();
    const results: Array<{ symbol: string; full_name: string; description: string; exchange: string; ticker: string; type: string }> = [];

    // Search CME Futures catalog
    for (const [key, spec] of Object.entries(FUTURES_INSTRUMENTS)) {
      if (!type || type.toLowerCase() === 'futures') {
        if (!q || key.includes(q) || spec.name.toUpperCase().includes(q)) {
          results.push({
            symbol: key,
            full_name: `${spec.exchange}:${key}`,
            description: spec.name,
            exchange: spec.exchange,
            ticker: key,
            type: 'futures',
          });
        }
      }
    }

    // Common Equities
    const commonEquities = [
      { sym: 'SPY', name: 'SPDR S&P 500 ETF Trust' },
      { sym: 'QQQ', name: 'Invesco QQQ Trust' },
      { sym: 'AAPL', name: 'Apple Inc.' },
      { sym: 'MSFT', name: 'Microsoft Corporation' },
      { sym: 'NVDA', name: 'NVIDIA Corporation' },
      { sym: 'TSLA', name: 'Tesla, Inc.' },
      { sym: 'AMD', name: 'Advanced Micro Devices, Inc.' },
      { sym: 'AMZN', name: 'Amazon.com, Inc.' },
      { sym: 'META', name: 'Meta Platforms, Inc.' },
      { sym: 'GOOGL', name: 'Alphabet Inc. Class A' },
    ];

    if (!type || type.toLowerCase() === 'stock') {
      for (const eq of commonEquities) {
        if (!q || eq.sym.includes(q) || eq.name.toUpperCase().includes(q)) {
          results.push({
            symbol: eq.sym,
            full_name: `NASDAQ:${eq.sym}`,
            description: eq.name,
            exchange: 'NASDAQ',
            ticker: eq.sym,
            type: 'stock',
          });
        }
      }
    }

    // Dynamic resolution if user typed a specific query not in list
    if (results.length === 0 && q) {
      results.push({
        symbol: q,
        full_name: `DATABENTO:${q}`,
        description: `${q} Market Instrument`,
        exchange: 'DATABENTO',
        ticker: q,
        type: q.includes('.OPT') ? 'option' : 'stock',
      });
    }

    return results.slice(0, limit);
  }

  /**
   * 5. TradingView History Bars
   */
  public async getUdfHistory(
    symbol: string,
    resolution: string,
    fromSec: number,
    toSec: number,
    countback?: number
  ): Promise<UdfHistoryResponse> {
    const resConfig = parseTradingViewResolution(resolution);
    const { dataset, querySymbol, stypeIn } = resolveSymbolForDatabento(symbol);

    const fromMs = fromSec * 1000;
    const toMs = toSec * 1000;

    try {
      const baseBars = await this.client.getHistoricalBars(
        dataset,
        querySymbol,
        resConfig.databentoSchema,
        new Date(fromMs),
        new Date(toMs),
        countback ? countback * 2 : 2000,
        stypeIn
      );

      if (!baseBars || baseBars.length === 0) {
        return { s: 'no_data' };
      }

      // Aggregate if target interval > schema base interval
      const baseIntervalSec = resConfig.databentoSchema === 'ohlcv-1s'
        ? 1
        : resConfig.databentoSchema === 'ohlcv-1m'
        ? 60
        : resConfig.databentoSchema === 'ohlcv-1h'
        ? 3600
        : 86400;

      let finalBars = baseBars;
      if (resConfig.intervalSeconds > baseIntervalSec) {
        finalBars = aggregateBars(baseBars, resConfig.intervalSeconds);
      }

      if (countback && countback > 0 && finalBars.length > countback) {
        finalBars = finalBars.slice(-countback);
      }

      const t: number[] = [];
      const o: number[] = [];
      const h: number[] = [];
      const l: number[] = [];
      const c: number[] = [];
      const v: number[] = [];

      for (const bar of finalBars) {
        t.push(Math.floor(bar.time / 1000));
        o.push(bar.open);
        h.push(bar.high);
        l.push(bar.low);
        c.push(bar.close);
        v.push(bar.volume);
      }

      return {
        s: 'ok',
        t,
        o,
        h,
        l,
        c,
        v,
      };
    } catch (err: any) {
      console.warn(`[ChartService] Error fetching UDF history for ${symbol}:`, err?.message || err);
      return { s: 'no_data' };
    }
  }

  /**
   * 6. TradingView Marks (Settlement, Trading Halts)
   */
  public async getUdfMarks(symbol: string, fromSec: number, toSec: number): Promise<UdfMarksResponse> {
    const { dataset, querySymbol } = resolveSymbolForDatabento(symbol);
    const marks: UdfMarksResponse = {
      id: [],
      time: [],
      color: [],
      text: [],
      label: [],
      labelFontColor: [],
      minSize: [],
    };

    try {
      const [stats, statuses] = await Promise.all([
        this.client.getStatistics(dataset, [querySymbol], fromSec * 1000, toSec * 1000).catch(() => []),
        this.client.getTradingStatus(dataset, [querySymbol], fromSec * 1000, toSec * 1000).catch(() => []),
      ]);

      let markId = 1;
      for (const stat of stats) {
        if (stat.settlementPrice) {
          marks.id.push(markId++);
          marks.time.push(Math.floor(stat.timestamp / 1000));
          marks.color = [...marks.color, '#2962FF'];
          marks.text.push(`Daily Settlement: ${stat.settlementPrice.toFixed(2)}${stat.openInterest ? ` (OI: ${stat.openInterest})` : ''}`);
          marks.label.push('S');
          marks.labelFontColor.push('#FFFFFF');
          marks.minSize.push(14);
        }
      }

      for (const st of statuses) {
        if (st.status.toLowerCase().includes('halt') || st.status.toLowerCase().includes('suspend')) {
          marks.id.push(markId++);
          marks.time.push(Math.floor(st.timestamp / 1000));
          marks.color.push('#F44336');
          marks.text.push(`Trading Halt: ${st.reason || st.status}`);
          marks.label.push('H');
          marks.labelFontColor.push('#FFFFFF');
          marks.minSize.push(14);
        }
      }
    } catch {
      // ignore mark errors gracefully
    }

    return marks;
  }

  /**
   * 7. TradingView Timescale Marks (Session Open/Close)
   */
  public getUdfTimescaleMarks(symbol: string, fromSec: number, toSec: number): UdfTimescaleMarksResponse {
    const fromMs = fromSec * 1000;
    const toMs = toSec * 1000;
    const dayMs = 86400000;

    const res: UdfTimescaleMarksResponse = {
      id: [],
      time: [],
      color: [],
      label: [],
      tooltip: [],
    };

    let startDay = Math.floor(fromMs / dayMs) * dayMs;
    let id = 1;
    while (startDay <= toMs) {
      // Regular US session open 9:30 AM ET (approx 13:30 or 14:30 UTC)
      const sessionOpenSec = Math.floor((startDay + 13.5 * 3600 * 1000) / 1000);
      if (sessionOpenSec >= fromSec && sessionOpenSec <= toSec) {
        res.id.push(id++);
        res.time.push(sessionOpenSec);
        res.color.push('#00E676');
        res.label.push('RTH');
        res.tooltip.push('Regular Trading Hours Open (09:30 ET)');
      }
      startDay += dayMs;
    }

    return res;
  }

  /**
   * 8. Order Flow Footprint Data
   */
  public async getFootprintData(
    symbol: string,
    resolution = '1',
    fromMs?: number,
    toMs?: number
  ): Promise<FootprintBarResponse[]> {
    const { dataset, querySymbol } = resolveSymbolForDatabento(symbol);
    const start = fromMs || (Date.now() - 3600_000);
    const end = toMs || Date.now();

    const root = symbol.toUpperCase().split('.')[0];
    const spec = FUTURES_INSTRUMENTS[symbol] || FUTURES_INSTRUMENTS[root];
    const tickSize = spec?.tickSize || 0.25;

    const resConfig = parseTradingViewResolution(resolution);
    const barDurationMs = resConfig.intervalSeconds * 1000;

    const trades = await this.client.getHistoricalTrades(dataset, [querySymbol], start, end, 10000);

    const footprintEngine = new FootprintEngine(tickSize, barDurationMs);
    const barsMap = new Map<number, FootprintBarResponse>();

    const mapBar = (b: any): FootprintBarResponse => {
      const rawLevels = Object.values(b.levels || {});
      const levels: any[] = rawLevels.map((lvl: any) => ({
        price: lvl.price,
        buyVolume: lvl.askVol,
        sellVolume: lvl.bidVol,
        totalVolume: lvl.totalVol,
        delta: lvl.delta,
        isImbalanceBuy: Boolean(lvl.askImbalance),
        isImbalanceSell: Boolean(lvl.bidImbalance),
      }));

      const stackedBuy: number[] = [];
      const stackedSell: number[] = [];
      for (const lvl of rawLevels as any[]) {
        if (lvl.stackedAskImbalance) stackedBuy.push(lvl.price);
        if (lvl.stackedBidImbalance) stackedSell.push(lvl.price);
      }

      return {
        time: b.time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
        delta: b.delta,
        cumulativeDelta: b.cvd,
        poc: b.poc,
        levels,
        stackedImbalances: {
          buy: stackedBuy,
          sell: stackedSell,
        },
      };
    };

    for (const t of trades) {
      const tick: Tick = {
        price: t.price,
        size: t.size,
        timestamp: t.timestamp,
        side: t.side,
        id: t.tradeId || `${t.timestamp}_${t.price}_${t.size}`,
      };

      const { currentBar, closedBar } = footprintEngine.processTick(tick);
      if (closedBar) {
        barsMap.set(closedBar.time, mapBar(closedBar));
      }
      if (currentBar) {
        barsMap.set(currentBar.time, mapBar(currentBar));
      }
    }

    return Array.from(barsMap.values()).sort((a, b) => a.time - b.time);
  }

  /**
   * 9. Cumulative Volume Delta (CVD)
   */
  public async getCvdData(
    symbol: string,
    fromMs?: number,
    toMs?: number
  ): Promise<CvdPoint[]> {
    const { dataset, querySymbol } = resolveSymbolForDatabento(symbol);
    const start = fromMs || (Date.now() - 3600_000);
    const end = toMs || Date.now();

    const trades = await this.client.getHistoricalTrades(dataset, [querySymbol], start, end, 5000);
    const points: CvdPoint[] = [];
    let runningCvd = 0;

    for (const t of trades) {
      const isBuy = t.side === 'buy';
      const buyVol = isBuy ? t.size : 0;
      const sellVol = !isBuy ? t.size : 0;
      const delta = buyVol - sellVol;
      runningCvd += delta;

      points.push({
        time: t.timestamp,
        buyVolume: buyVol,
        sellVolume: sellVol,
        delta,
        cumulativeDelta: runningCvd,
      });
    }

    return points;
  }

  /**
   * 10. Volume Profile (POC, VAH, VAL)
   */
  public async getVolumeProfile(
    symbol: string,
    fromMs?: number,
    toMs?: number
  ): Promise<VolumeProfileResponse> {
    const { dataset, querySymbol, stypeIn } = resolveSymbolForDatabento(symbol);
    const start = fromMs || (Date.now() - 86400_000);
    const end = toMs || Date.now();

    const root = symbol.toUpperCase().split('.')[0];
    const spec = FUTURES_INSTRUMENTS[symbol] || FUTURES_INSTRUMENTS[root];
    const tickSize = spec?.tickSize || 0.25;

    const bars = await this.client.getHistoricalBars(dataset, [querySymbol], 'ohlcv-1m', start, end, 1440, stypeIn);

    const profileEngine = new ProfileEngine(tickSize, start);
    profileEngine.processHistoricalBars(bars);
    const vp = profileEngine.getVolumeProfile();

    return {
      symbol,
      totalVolume: vp.totalVolume,
      poc: vp.poc,
      vah: vp.vah,
      val: vp.val,
      levels: vp.levels,
    };
  }

  /**
   * 11. VWAP with Standard Deviation Bands
   */
  public async getVwapData(
    symbol: string,
    fromMs?: number,
    toMs?: number
  ): Promise<VwapPointResponse[]> {
    const { dataset, querySymbol, stypeIn } = resolveSymbolForDatabento(symbol);
    const start = fromMs || (Date.now() - 86400_000);
    const end = toMs || Date.now();

    const bars = await this.client.getHistoricalBars(dataset, [querySymbol], 'ohlcv-1m', start, end, 1440, stypeIn);

    const vwapEngine = new VWAPEngine(start);
    vwapEngine.processHistoricalBars(bars);
    const history = vwapEngine.getHistory();

    return history.map((pt) => ({
      time: pt.time,
      vwap: pt.vwap,
      upper1: pt.upper1,
      lower1: pt.lower1,
      upper2: pt.upper2,
      lower2: pt.lower2,
      upper3: pt.upper3,
      lower3: pt.lower3,
    }));
  }

  /**
   * 12. Depth Heatmap (MBP-10)
   */
  public async getDepthHeatmap(
    symbol: string,
    fromMs?: number,
    toMs?: number
  ): Promise<DepthHeatmapSnapshot[]> {
    const { dataset, querySymbol } = resolveSymbolForDatabento(symbol);
    const start = fromMs || (Date.now() - 3600_000);
    const end = toMs || Date.now();

    const depthRecords = await this.client.getHistoricalDepth(dataset, [querySymbol], start, end, 500);

    return depthRecords.map((r: any) => {
      const bids: Array<{ price: number; size: number }> = [];
      const asks: Array<{ price: number; size: number }> = [];

      for (let i = 0; i < 10; i++) {
        const pad = String(i).padStart(2, '0');
        const bp = r[`bid_px_${pad}`];
        const bs = r[`bid_sz_${pad}`];
        const ap = r[`ask_px_${pad}`];
        const asz = r[`ask_sz_${pad}`];

        if (bp && bs) bids.push({ price: Number(bp) / 1e9, size: Number(bs) });
        if (ap && asz) asks.push({ price: Number(ap) / 1e9, size: Number(asz) });
      }

      return {
        time: Math.floor(Number(r.ts_event ?? r.hd?.ts_event ?? 0) / 1e6),
        bids,
        asks,
      };
    });
  }

  /**
   * 13. Institutional Large Trades / Block Executions
   */
  public async getLargeTrades(
    symbol: string,
    fromMs?: number,
    toMs?: number,
    minSize = 50,
    minUsd = 100_000
  ): Promise<LargeTradePrint[]> {
    const { dataset, querySymbol } = resolveSymbolForDatabento(symbol);
    const start = fromMs || (Date.now() - 3600_000);
    const end = toMs || Date.now();

    const trades = await this.client.getHistoricalTrades(dataset, [querySymbol], start, end, 5000);
    const root = symbol.toUpperCase().split('.')[0];
    const spec = FUTURES_INSTRUMENTS[symbol] || FUTURES_INSTRUMENTS[root];
    const pointValue = spec?.pointValue || 1;

    const largeTrades: LargeTradePrint[] = [];

    for (const t of trades) {
      const usdValue = t.price * t.size * pointValue;
      if (t.size >= minSize || usdValue >= minUsd) {
        largeTrades.push({
          time: t.timestamp,
          price: t.price,
          size: t.size,
          side: t.side,
          usdValue,
          isWhale: t.size >= minSize * 2 || usdValue >= minUsd * 2,
        });
      }
    }

    return largeTrades;
  }

  /**
   * 14. Key Gamma & Institutional S/R Levels (Call Wall, Put Wall, Zero-Gamma Flip)
   */
  public async getChartLevels(symbol: string): Promise<ChartLevelsResponse> {
    const s = symbol.toUpperCase().trim();
    let underlying = s;
    if (s === 'ES' || s === 'MES') underlying = 'SPY';
    else if (s === 'NQ' || s === 'MNQ') underlying = 'QQQ';
    else if (s === 'RTY' || s === 'M2K') underlying = 'IWM';

    const latestExp = marketDataStore.getLatestExposure(underlying);
    if (latestExp) {
      return {
        symbol: s,
        currentPrice: latestExp.spot,
        gammaFlip: latestExp.gammaFlip ?? undefined,
        callWall: latestExp.walls.callWall,
        putWall: latestExp.walls.putWall,
        supportLevels: [latestExp.walls.putWall].filter(Boolean),
        resistanceLevels: [latestExp.walls.callWall].filter(Boolean),
        source: 'DATABENTO_OPRA',
      };
    }

    return {
      symbol: s,
      currentPrice: 0,
      supportLevels: [],
      resistanceLevels: [],
      source: 'DATABENTO_OPRA',
    };
  }
}

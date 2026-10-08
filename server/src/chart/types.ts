/**
 * TradingView & Chart Order Flow Type Definitions
 *
 * Covers standard TradingView UDF (Universal Datafeed) API specification
 * and Institutional Order Flow chart extensions powered by Databento.
 */

export interface UdfConfig {
  supported_resolutions: string[];
  supports_group_request: boolean;
  supports_marks: boolean;
  supports_search: boolean;
  supports_time: boolean;
  supports_timescale_marks: boolean;
  symbols_types: Array<{ name: string; value: string }>;
}

export interface UdfSymbolInfo {
  name: string;
  ticker: string;
  description: string;
  type: string;
  session: string;
  exchange: string;
  listed_exchange: string;
  timezone: string;
  minmov: number;
  pricescale: number;
  minmove2: number;
  fractional: boolean;
  has_intraday: boolean;
  has_seconds: boolean;
  has_daily: boolean;
  has_weekly_and_monthly: boolean;
  supported_resolutions: string[];
  intraday_multipliers: string[];
  seconds_multipliers: string[];
  currency_code: string;
  volume_precision: number;
}

export interface UdfHistoryResponse {
  s: 'ok' | 'no_data' | 'error';
  errmsg?: string;
  t?: number[]; // Unix timestamps in seconds
  o?: number[];
  h?: number[];
  l?: number[];
  c?: number[];
  v?: number[];
  nextTime?: number;
}

export interface UdfMarksResponse {
  id: (number | string)[];
  time: number[]; // Unix timestamps in seconds
  color: string[];
  text: string[];
  label: string[];
  labelFontColor: string[];
  minSize: number[];
}

export interface UdfTimescaleMarksResponse {
  id: (number | string)[];
  time: number[];
  color: string[];
  label: string[];
  tooltip: string[];
}

interface FootprintLevel {
  price: number;
  buyVolume: number;
  sellVolume: number;
  totalVolume: number;
  delta: number;
  isImbalanceBuy: boolean;
  isImbalanceSell: boolean;
}

export interface FootprintBarResponse {
  time: number; // Unix ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  delta: number;
  cumulativeDelta: number;
  poc: number;
  levels: FootprintLevel[];
  stackedImbalances: {
    buy: number[];
    sell: number[];
  };
}

export interface CvdPoint {
  time: number; // Unix ms
  buyVolume: number;
  sellVolume: number;
  delta: number;
  cumulativeDelta: number;
}

export interface VolumeProfileResponse {
  symbol: string;
  totalVolume: number;
  poc: number;
  vah: number;
  val: number;
  levels: Array<{
    price: number;
    volume: number;
    buyVolume: number;
    sellVolume: number;
    delta: number;
  }>;
}

export interface VwapPointResponse {
  time: number; // Unix ms
  vwap: number;
  upper1: number;
  lower1: number;
  upper2: number;
  lower2: number;
  upper3: number;
  lower3: number;
}

export interface DepthHeatmapSnapshot {
  time: number; // Unix ms
  bids: Array<{ price: number; size: number }>;
  asks: Array<{ price: number; size: number }>;
}

export interface LargeTradePrint {
  time: number; // Unix ms
  price: number;
  size: number;
  side: 'buy' | 'sell' | 'unknown';
  usdValue: number;
  isWhale: boolean;
}

export interface ChartLevelsResponse {
  symbol: string;
  currentPrice: number;
  gammaFlip?: number;
  callWall?: number;
  putWall?: number;
  maxPain?: number;
  supportLevels: number[];
  resistanceLevels: number[];
  source: string;
}

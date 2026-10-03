/**
 * Resolves a chart symbol (futures contract, equity, ETF, or index) to its corresponding
 * Databento equity/ETF ticker for options flow, Spot GEX, and institutional intelligence.
 *
 * For authentic equities & ETFs (AAPL, NVDA, SPY, QQQ, SPX, etc.), the symbol is passed through directly.
 * For CME futures (ES, NQ, CL, GC, etc.), maps to the corresponding liquid underlying ETF.
 */
export function resolveMarketIntelligenceTicker(rawSymbol: string): string {
  if (!rawSymbol) return 'SPY';
  const sym = rawSymbol.trim().toUpperCase();

  // 1. Direct equities and ETFs: pass through as-is
  const DIRECT_PASS = new Set([
    'SPY', 'QQQ', 'IWM', 'DIA', 'SPX', 'NDX', 'VIX',
    'AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMZN', 'META', 'GOOGL', 'GOOG',
    'AMD', 'SMCI', 'PLTR', 'COIN', 'MSTR', 'GLD', 'SLV', 'USO', 'UNG', 'TLT', 'IBIT'
  ]);
  if (DIRECT_PASS.has(sym)) {
    return sym;
  }

  // 2. Strip contract month suffix if present (e.g. ESH6 -> ES, NQZ24 -> NQ, CLF25 -> CL)
  const root = sym.replace(/[FGHJKMNQUVXZ]\d{1,2}$/, '');

  // 3. CME Futures to underlying ETF options proxy map
  const FUTURES_ETF_MAP: Record<string, string> = {
    ES: 'SPY',
    MES: 'SPY',
    NQ: 'QQQ',
    MNQ: 'QQQ',
    YM: 'DIA',
    MYM: 'DIA',
    RTY: 'IWM',
    M2K: 'IWM',
    GC: 'GLD',
    MGC: 'GLD',
    SI: 'SLV',
    SIL: 'SLV',
    CL: 'USO',
    MCL: 'USO',
    NG: 'UNG',
    MNG: 'UNG',
    ZB: 'TLT',
    ZN: 'TLT',
    ZF: 'TLT',
    ZT: 'TLT',
    BTC: 'IBIT',
    MBT: 'IBIT',
  };

  if (FUTURES_ETF_MAP[root]) {
    return FUTURES_ETF_MAP[root];
  }
  if (FUTURES_ETF_MAP[sym]) {
    return FUTURES_ETF_MAP[sym];
  }

  // 4. Default: If not a known futures root, treat as direct equity/ETF symbol (e.g. any stock ticker typed by user)
  return sym;
}

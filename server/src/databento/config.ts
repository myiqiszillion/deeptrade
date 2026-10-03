/**
 * Databento Configuration
 *
 * Centralizes env resolution for all Databento datasets.
 * Never throws at import time — missing keys yield UNAVAILABLE state.
 */

export interface DatabentoConfig {
  apiKey: string;
  histBaseUrl: string;
  liveBaseUrl: string;
  opraDataset: string;
  equitiesDataset: string;
  cmeDataset: string;
  costCapUsd: number;
  timeoutMs: number;
  maxRetries: number;
  symbols: string[];
}

function parseCostCap(raw: string | undefined): number {
  const n = parseFloat(raw || '');
  if (Number.isFinite(n) && n > 0) return n;
  return 50;
}

export function resolveDatabentoConfig(env: NodeJS.ProcessEnv = process.env): DatabentoConfig {
  return {
    apiKey: (env.DATABENTO_API_KEY || '').trim(),
    histBaseUrl: (env.DATABENTO_HIST_URL || 'https://hist.databento.com/v0').replace(/\/+$/, ''),
    liveBaseUrl: (env.DATABENTO_LIVE_URL || 'wss://live.databento.com/v0').replace(/\/+$/, ''),
    opraDataset: (env.DATABENTO_OPRA_DATASET || 'OPRA.PILLAR').trim(),
    equitiesDataset: (env.DATABENTO_EQUITIES_DATASET || 'DBEQ.BASIC').trim(),
    cmeDataset: (env.DATABENTO_CME_DATASET || 'GLBX.MDP3').trim(),
    costCapUsd: parseCostCap(env.DATABENTO_COST_CAP_USD),
    timeoutMs: parseInt(env.DATABENTO_TIMEOUT_MS || '15000', 10),
    maxRetries: parseInt(env.DATABENTO_MAX_RETRIES || '3', 10),
    symbols: [...new Set((env.DATABENTO_SYMBOLS || 'ES,NQ,MES,MNQ,CL,GC,ZB,ZN,UB,RTY,SPY,QQQ,AAPL,NVDA,MSFT,TSLA')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean) as string[])],
  };
}

export function databentoConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.DATABENTO_API_KEY && env.DATABENTO_API_KEY.trim().length > 0);
}

/** Human-safe reason for FeedStatusEvent when key is missing. */
export function missingKeyReason(): string {
  return 'no API key configured (set DATABENTO_API_KEY)';
}

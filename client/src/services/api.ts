import { FuturesInstrument, GEXProfile, OptionsFlowTrade, Tick } from '../types';

const API_BASE = typeof window !== 'undefined' ? (window.location.port === '5173' ? 'http://localhost:8080' : '') : '';

export interface InstrumentSummary extends FuturesInstrument {
  provider: string;
  feedStatus: 'LIVE' | 'CONNECTING' | 'UNAVAILABLE';
  isLive: boolean;
}

export interface SystemStatus {
  status: string;
  uptimeSec: number;
  sessions: number;
  uniqueUsers: number;
  futuresProvider: string;
  activeContexts: {
    symbol: string;
    provider: string;
    feedStatus: string;
    subscribers: number;
    lastTradeTs: number;
    lastDepthTs: number;
  }[];
  memory: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  };
  nodeVersion: string;
  timestamp: number;
}

export interface ReplayStats {
  symbol: string;
  provider: string;
  storedTicksCount: number;
  memoryTicksCount: number;
  availableTicksCount: number;
  earliestTimestamp: number;
  latestTimestamp: number;
  canReplay: boolean;
}

export interface CoverageItem {
  symbol: string;
  name: string;
  exchange: string;
  category: string;
  provider: string;
  realtime: 'LIVE' | 'UNAVAILABLE' | 'DEGRADED';
  history: 'NONE' | 'BARS' | 'TICKS';
  footprint: 'AVAILABLE' | 'UNAVAILABLE';
  orderbook: 'NONE' | 'L2' | 'MBO';
  gapStatus: 'NONE' | 'DETECTED' | 'RECOVERED' | 'UNRECOVERED';
}

function getStoredToken(): string | null {
  try {
    return localStorage.getItem('deepchart_jwt_token');
  } catch {
    return null;
  }
}

export function saveStoredToken(token: string): void {
  try {
    localStorage.setItem('deepchart_jwt_token', token);
  } catch {}
}

export class ApiError extends Error {
  public statusCode: number;
  public data: any;

  constructor(message: string, statusCode: number, data?: any) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.data = data;
  }
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch (err) {
    console.warn(`[DeepChart API] Network failure calling ${path}:`, err);
    throw new ApiError(
      err instanceof Error ? err.message : 'Network error or service unreachable',
      0,
      err
    );
  }

  if (!res.ok) {
    let errorBody: any = null;
    try {
      errorBody = await res.json();
    } catch {
      try {
        errorBody = await res.text();
      } catch {}
    }
    const message =
      (errorBody && typeof errorBody === 'object' && errorBody.message)
        ? errorBody.message
        : (errorBody && typeof errorBody === 'object' && errorBody.error)
        ? errorBody.error
        : `HTTP Error ${res.status}: ${res.statusText}`;
    throw new ApiError(message, res.status, errorBody);
  }

  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return null as T;
  }

  return (await res.json()) as T;
}

export const deepchartApi = {
  async getInstruments(): Promise<InstrumentSummary[]> {
    const data = await apiFetch<{ instruments: InstrumentSummary[]; total: number }>('/api/v1/instruments');
    return data?.instruments || [];
  },

  async getInstrument(symbol: string): Promise<{ instrument: FuturesInstrument; feedStatus: string; provider: string }> {
    return apiFetch<{ instrument: FuturesInstrument; feedStatus: string; provider: string }>(`/api/v1/instruments/${symbol}`);
  },

  async getStatus(): Promise<SystemStatus> {
    return apiFetch<SystemStatus>('/api/v1/status');
  },

  async getCoverage(): Promise<CoverageItem[]> {
    const data = await apiFetch<{ coverage: CoverageItem[] }>('/api/v1/coverage');
    return data?.coverage || [];
  },

  async getGex(symbol = 'SPX'): Promise<GEXProfile> {
    return apiFetch<GEXProfile>(`/api/v1/gex?symbol=${encodeURIComponent(symbol)}`);
  },

  async getOptionsFlow(symbol?: string): Promise<OptionsFlowTrade[]> {
    const query = symbol ? `?symbol=${encodeURIComponent(symbol)}` : '';
    const data = await apiFetch<{ optionsFlow: OptionsFlowTrade[] }>(`/api/v1/options-flow${query}`);
    return data?.optionsFlow || [];
  },

  async getTrades(symbol: string, limit = 100, beforeTime?: number): Promise<Tick[]> {
    const params = new URLSearchParams({ symbol, limit: String(limit) });
    if (beforeTime) params.set('beforeTime', String(beforeTime));
    const data = await apiFetch<{ trades: Tick[] }>(`/api/v1/trades?${params.toString()}`);
    return data?.trades || [];
  },

  async getReplayStats(symbol: string): Promise<ReplayStats> {
    return apiFetch<ReplayStats>(`/api/v1/replay/stats?symbol=${encodeURIComponent(symbol)}`);
  },

  async login(username = 'guest', role: 'user' | 'admin' = 'user'): Promise<{ token: string; user: any }> {
    const res = await apiFetch<{ token: string; user: any }>('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, role }),
    });
    if (res?.token) {
      saveStoredToken(res.token);
    }
    return res;
  },

  async getMe(): Promise<{ user: any; entitlements: any[] }> {
    return apiFetch<{ user: any; entitlements: any[] }>('/api/v1/auth/me');
  },
};

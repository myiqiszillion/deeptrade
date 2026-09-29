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

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T | null> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[DeepChart API] Error calling ${path}:`, err);
    return null;
  }
}

export const deepchartApi = {
  async getInstruments(): Promise<InstrumentSummary[]> {
    const data = await apiFetch<{ instruments: InstrumentSummary[]; total: number }>('/api/v1/instruments');
    return data?.instruments || [];
  },

  async getInstrument(symbol: string): Promise<{ instrument: FuturesInstrument; feedStatus: string; provider: string } | null> {
    return apiFetch<{ instrument: FuturesInstrument; feedStatus: string; provider: string }>(`/api/v1/instruments/${symbol}`);
  },

  async getStatus(): Promise<SystemStatus | null> {
    return apiFetch<SystemStatus>('/api/v1/status');
  },

  async getCoverage(): Promise<CoverageItem[]> {
    const data = await apiFetch<{ coverage: CoverageItem[] }>('/api/v1/coverage');
    return data?.coverage || [];
  },

  async getGex(symbol = 'SPX'): Promise<GEXProfile | null> {
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

  async getReplayStats(symbol: string): Promise<ReplayStats | null> {
    return apiFetch<ReplayStats>(`/api/v1/replay/stats?symbol=${encodeURIComponent(symbol)}`);
  },

  async login(username = 'guest', role: 'user' | 'admin' = 'user'): Promise<{ token: string; user: any } | null> {
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

  async getMe(): Promise<{ user: any; entitlements: any[] } | null> {
    return apiFetch<{ user: any; entitlements: any[] }>('/api/v1/auth/me');
  },
};

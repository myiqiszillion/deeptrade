import {
  ChartLevels,
  DepthHeatmapResponse,
  FuturesInstrument,
  GEXProfile,
  OptionChainResponse,
  OptionsFlowTrade,
  Tick,
  VolumeProfileRangeData,
  AlertRule,
  CreateAlertRuleInput,
  AlertHistoryItem,
} from '../types';

const API_BASE = typeof window !== 'undefined' ? (window.location.port === '5173' ? 'http://localhost:8080' : '') : '';

export interface InstrumentSummary extends FuturesInstrument {
  provider: string;
  feedStatus: 'LIVE' | 'CONNECTING' | 'IDLE' | 'UNAVAILABLE' | 'ERROR';
  /** True when the server already tracks a market context for this symbol (someone subscribed). */
  subscribed?: boolean;
  /** False when no vendor is configured at all (FUTURES_PROVIDER=none): nothing can ever go live. */
  feedConfigured?: boolean;
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

export interface PlanSummary {
  id: string;
  name: string;
  priceUsdMonthly: number;
  features: string[];
  maxConcurrentSessions: number;
  historyDays: number;
  dataTypes: string[];
  symbolPatterns: string[];
}

export interface AuthConfigResponse {
  authRequired: boolean;
  devMode: boolean;
  registrationEnabled: boolean;
  billingConfigured: boolean;
  defaultPlanId: string;
  plans: PlanSummary[];
}

export interface SubscriptionResponse {
  userId: string;
  planId: string;
  status: 'active' | 'past_due' | 'canceled';
  currentPeriodEnd: number;
  provider: string;
}

export function clearStoredToken(): void {
  try {
    localStorage.removeItem('deepchart_jwt_token');
  } catch {}
}

export function hasStoredToken(): boolean {
  return Boolean(getStoredToken());
}

export interface WatchlistQuote {
  symbol: string;
  price: number;
  ts: number;
  ageMs: number;
  source: string;
  stale: boolean;
}

export interface QuoteBoardResponse {
  enabled: boolean;
  ttlMs?: number;
  quotes: WatchlistQuote[];
  hint?: string;
}

export const deepchartApi = {
  async getInstruments(): Promise<InstrumentSummary[]> {
    const data = await apiFetch<{ instruments: InstrumentSummary[]; total: number }>('/api/v1/instruments');
    return data?.instruments || [];
  },

  async getInstrument(symbol: string): Promise<{ instrument: FuturesInstrument; feedStatus: string; provider: string }> {
    return apiFetch<{ instrument: FuturesInstrument; feedStatus: string; provider: string }>(`/api/v1/instruments/${symbol}`);
  },

  /** Watchlist last-trade quotes. Returns `enabled:false` when the operator has not opted in. */
  async getQuotes(symbols: string[]): Promise<QuoteBoardResponse> {
    const list = symbols.slice(0, 8).map((s) => encodeURIComponent(s)).join(',');
    const data = await apiFetch<QuoteBoardResponse>(`/api/v1/quotes?symbols=${list}`);
    return data ?? { enabled: false, quotes: [] };
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

  async getOptionsChain(underlying = 'SPY', expiration?: string): Promise<OptionChainResponse> {
    const params = new URLSearchParams({ underlying });
    if (expiration) params.set('expiration', expiration);
    return apiFetch<OptionChainResponse>(`/api/v1/options/chain?${params.toString()}`);
  },

  async getChartLevels(symbol = 'ES'): Promise<ChartLevels> {
    return apiFetch<ChartLevels>(`/api/v1/chart/levels?symbol=${encodeURIComponent(symbol)}`);
  },

  async getVolumeProfileRange(symbol: string, startTime: number, endTime: number): Promise<VolumeProfileRangeData> {
    return apiFetch<VolumeProfileRangeData>('/api/v1/chart/volume-profile-range', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, startTime, endTime }),
    });
  },

  async getDepthHeatmap(
    symbol = 'ES',
    from?: number,
    to?: number,
    resolution?: number,
    limit?: number,
    offset?: number
  ): Promise<DepthHeatmapResponse> {
    const params = new URLSearchParams({ symbol });
    if (from !== undefined) params.set('from', String(from));
    if (to !== undefined) params.set('to', String(to));
    if (resolution !== undefined) params.set('resolution', String(resolution));
    if (limit !== undefined) params.set('limit', String(limit));
    if (offset !== undefined) params.set('offset', String(offset));
    return apiFetch<DepthHeatmapResponse>(`/api/v1/chart/depth-heatmap?${params.toString()}`);
  },

  async getExposure(underlying = 'SPY'): Promise<any> {
    return apiFetch<any>(`/api/v1/exposure?underlying=${encodeURIComponent(underlying)}`);
  },

  async getVolSurface(underlying = 'SPY'): Promise<any> {
    return apiFetch<any>(`/api/v1/vol-surface?underlying=${encodeURIComponent(underlying)}`);
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

  async login(username: string, password: string): Promise<{ token: string; user: any; plan?: PlanSummary }> {
    const res = await apiFetch<{ token: string; user: any; plan?: PlanSummary }>('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (res?.token) {
      saveStoredToken(res.token);
    }
    return res;
  },

  async register(username: string, password: string): Promise<{ token: string; user: any; plan?: PlanSummary }> {
    const res = await apiFetch<{ token: string; user: any; plan?: PlanSummary }>('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (res?.token) {
      saveStoredToken(res.token);
    }
    return res;
  },

  async logout(): Promise<void> {
    try {
      await apiFetch<{ message: string }>('/api/v1/auth/logout', { method: 'POST' });
    } catch {
      // Revocation is best effort: the client drops the token either way.
    }
    clearStoredToken();
  },

  async getAuthConfig(): Promise<AuthConfigResponse> {
    return apiFetch<AuthConfigResponse>('/api/v1/auth/config');
  },

  async getBillingPlans(): Promise<{ plans: PlanSummary[]; billingConfigured: boolean }> {
    return apiFetch<{ plans: PlanSummary[]; billingConfigured: boolean }>('/api/v1/billing/plans');
  },

  async getSubscription(): Promise<{ subscription: SubscriptionResponse | null; plan: PlanSummary }> {
    return apiFetch<{ subscription: SubscriptionResponse | null; plan: PlanSummary }>('/api/v1/billing/subscription');
  },

  async startCheckout(planId: string): Promise<{ url: string }> {
    return apiFetch<{ url: string }>('/api/v1/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId }),
    });
  },

  async getMe(): Promise<{ user: any; entitlements: any[]; plan?: PlanSummary }> {
    return apiFetch<{ user: any; entitlements: any[]; plan?: PlanSummary }>('/api/v1/auth/me');
  },

  async listAlertRules(symbol?: string): Promise<{ rules: AlertRule[]; count: number }> {
    const qs = symbol ? `?symbol=${encodeURIComponent(symbol)}` : '';
    return apiFetch<{ rules: AlertRule[]; count: number }>(`/api/v1/alerts/rules${qs}`);
  },

  async createAlertRule(data: CreateAlertRuleInput): Promise<AlertRule> {
    return apiFetch<AlertRule>('/api/v1/alerts/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  },

  async updateAlertRule(ruleId: string, updates: Partial<CreateAlertRuleInput> & { enabled?: boolean }): Promise<AlertRule> {
    return apiFetch<AlertRule>(`/api/v1/alerts/rules/${encodeURIComponent(ruleId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
  },

  async deleteAlertRule(ruleId: string): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>(`/api/v1/alerts/rules/${encodeURIComponent(ruleId)}`, {
      method: 'DELETE',
    });
  },

  async getAlertHistory(options?: { symbol?: string; limit?: number; unreadOnly?: boolean }): Promise<{ history: AlertHistoryItem[]; count: number }> {
    const params = new URLSearchParams();
    if (options?.symbol) params.set('symbol', options.symbol);
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.unreadOnly) params.set('unreadOnly', 'true');
    const qs = params.toString() ? `?${params.toString()}` : '';
    return apiFetch<{ history: AlertHistoryItem[]; count: number }>(`/api/v1/alerts/history${qs}`);
  },

  async acknowledgeAlert(historyId: string): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>(`/api/v1/alerts/history/${encodeURIComponent(historyId)}/ack`, {
      method: 'POST',
    });
  },

  async clearAlertHistory(symbol?: string): Promise<{ deleted: number }> {
    const qs = symbol ? `?symbol=${encodeURIComponent(symbol)}` : '';
    return apiFetch<{ deleted: number }>(`/api/v1/alerts/history${qs}`, {
      method: 'DELETE',
    });
  },
};

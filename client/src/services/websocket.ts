import {
  AbsorptionAlert,
  DeepTrade,
  DataEvidence,
  EnhancedFeedStatus,
  FootprintBar,
  FuturesInstrument,
  GEXProfile,
  HistoricalBar,
  OptionsFlowTrade,
  OrderbookSnapshot,
  ReplayProgress,
  SpeedOfTapeData,
  TPOProfileData,
  Tick,
  VolumeProfileData,
  VWAPPoint,
  WSClientMessage,
  WSServerMessage,
  AlertEvent,
} from '../types';

export interface FeedHealthState {
  isConnected: boolean;
  reconnectCount: number;
  lastMessageTs: number | null;
  lastTradeTs: number | null;
  subscriptionState: 'UNSUBSCRIBED' | 'PENDING' | 'ACTIVE' | 'STALE' | 'RECOVERING' | 'ERROR';
  symbol: string | null;
  source: string | null;
  timeframe: string | null;
  staleThresholdMs: number;
}

/** Same key the REST client uses, so a login in the SPA authenticates the socket too. */
export function readAuthToken(): string | null {
  try {
    return localStorage.getItem('deepchart_jwt_token');
  } catch {
    return null;
  }
}

export interface WSListeners {
  onInitState?: (data: {
    dataEvidence?: DataEvidence;
    symbol: string;
    instrument?: FuturesInstrument;
    bars: FootprintBar[];
    orderbook: OrderbookSnapshot;
    volumeProfile: VolumeProfileData;
    tpo: TPOProfileData;
    vwap: VWAPPoint[];
    cvdHistory: { time: number; cvd: number }[];
    gexProfile?: GEXProfile;
    optionsFlow?: OptionsFlowTrade[];
    deepTradeThresholdUsd?: number;
    timeframe?: string;
    historySource?: 'NONE' | 'REAL_TICKS' | 'REAL_BARS';
    historyBars?: HistoricalBar[];
    feedStatus?: 'LIVE' | 'UNAVAILABLE';
    feedHealth?: import('../types').FeedHealthSnapshot;
    mode?: 'LIVE' | 'REPLAY' | 'REPLAY_PAUSED' | 'REPLAY_ENDED';
  }) => void;
  onTick?: (tick: Tick) => void;
  onBarUpdate?: (bar: FootprintBar) => void;
  onBarClose?: (bar: FootprintBar) => void;
  onOrderbookUpdate?: (orderbook: OrderbookSnapshot) => void;
  onSpeedOfTape?: (tape: SpeedOfTapeData) => void;
  onDeepTrade?: (trade: DeepTrade) => void;
  onAbsorption?: (alert: AbsorptionAlert) => void;
  onProfileUpdate?: (data: { volumeProfile: VolumeProfileData; tpo?: TPOProfileData }) => void;
  onVwapUpdate?: (point: VWAPPoint) => void;
  onGexUpdate?: (profile: GEXProfile) => void;
  onOptionsFlow?: (trade: OptionsFlowTrade) => void;
  onReplayState?: (progress: ReplayProgress) => void;
  onConnectionChange?: (connected: boolean) => void;
  onFeedStatusChange?: (status: EnhancedFeedStatus) => void;
  onFeedHealthUpdate?: (health: FeedHealthState) => void;
  /**
   * Server-initiated close that needs product UI rather than a silent retry:
   * 1008 = authentication/entitlement refused, 1013 = server at capacity.
   */
  onServerClose?: (info: { code: number; reason: string }) => void;
  onHistoryResponse?: (response: {
    symbol: string;
    timeframe: string;
    provider?: string;
    bars: HistoricalBar[];
    hasMore: boolean;
    cursor?: number | { provider: string; symbol: string; timeframe?: string; beforeTime: number; beforeId?: string };
    requestId?: string;
  }) => void;
  onError?: (error: { code: string; message: string }) => void;
  onLatencyUpdate?: (latencyMs: number) => void;
  onAlert?: (alert: AlertEvent) => void;
}

export class DeepChartWSClient {
  private ws: WebSocket | null = null;
  private url: string;
  private listeners: WSListeners = {};
  private isConnected = false;
  private reconnectTimer: any = null;
  private disconnectTimer: any = null;
  private pingTimer: any = null;
  private pendingPing: { token: number; mono: number } | null = null;
  private staleCheckTimer: any = null;
  private intentionalClose = false;

  // Observability & Subscription state
  private reconnectCount = 0;
  private lastMessageTs: number | null = null;
  private lastTradeTs: number | null = null;
  private subscriptionState: 'UNSUBSCRIBED' | 'PENDING' | 'ACTIVE' | 'STALE' | 'RECOVERING' | 'ERROR' = 'UNSUBSCRIBED';
  private activeSubscription: { symbol: string; source?: string; timeframe?: string } | null = null;
  private staleThresholdMs = 15000;

  constructor(url?: string) {
    const envUrl = import.meta.env.VITE_WS_URL as string | undefined;

    if (url) {
      this.url = url;
    } else if (envUrl) {
      this.url = envUrl;
    } else if (import.meta.env.PROD && typeof window !== 'undefined') {
      // Production build is served by the DeepChart server itself, so the socket lives on
      // the same origin — no configuration needed on a free host.
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      this.url = `${protocol}://${window.location.host}`;
    } else {
      this.url = 'ws://localhost:8080';
    }
  }

  private listenersMap = new Map<string, { symbol: string; listeners: WSListeners }>();

  public addListener(id: string, symbol: string, listeners: WSListeners) {
    this.listenersMap.set(id, { symbol, listeners });
  }

  public removeListener(id: string) {
    this.listenersMap.delete(id);
  }

  // Backwards compatibility for components not updated yet
  public setListeners(listeners: WSListeners) {
    this.addListener('default', this.activeSubscription?.symbol || 'ES', listeners);
  }

  public getFeedHealth(): FeedHealthState {
    return {
      isConnected: this.isConnected,
      reconnectCount: this.reconnectCount,
      lastMessageTs: this.lastMessageTs,
      lastTradeTs: this.lastTradeTs,
      subscriptionState: this.subscriptionState,
      symbol: this.activeSubscription?.symbol ?? null,
      source: this.activeSubscription?.source ?? null,
      timeframe: this.activeSubscription?.timeframe ?? null,
      staleThresholdMs: this.staleThresholdMs,
    };
  }

  private broadcast(action: (listeners: WSListeners) => void) {
    for (const listeners of new Set([this.listeners, ...Array.from(this.listenersMap.values(), entry => entry.listeners)])) action(listeners);
  }

  private notifyHealth() {
    this.broadcast(l => l.onFeedHealthUpdate?.(this.getFeedHealth()));
  }

  private startStaleChecker() {
    this.stopStaleChecker();
    this.staleCheckTimer = setInterval(() => {
      if (!this.isConnected) return;
      const now = Date.now();
      // Browser transport silence only. PONG/status activity never attests vendor freshness.
      // Authoritative vendor health arrives separately in the backend INIT_STATE snapshot.
      if (this.lastMessageTs && (now - this.lastMessageTs > this.staleThresholdMs)) {
        this.subscriptionState = 'STALE';
        // Browser transport silence is separate from backend vendor health.
      } else if (this.subscriptionState === 'STALE') {
        this.subscriptionState = 'RECOVERING';
      }
      this.notifyHealth();
    }, 4000);
  }

  private stopStaleChecker() {
    if (this.staleCheckTimer) {
      clearInterval(this.staleCheckTimer);
      this.staleCheckTimer = null;
    }
  }

  public connect() {
    this.intentionalClose = false;
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }

    if (this.ws) {
      // Re-use an already open or connecting socket (e.g. React 18 StrictMode remount)
      if (this.ws.readyState === WebSocket.OPEN) {
        this.isConnected = true;
        this.broadcast(l => l.onConnectionChange?.(true));
        this.notifyHealth();
        return;
      }
      if (this.ws.readyState === WebSocket.CONNECTING) {
        return;
      }
      // Detach handlers from closed/stale socket before creating a new one
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }

    try {
      // The token travels in the WebSocket subprotocol header: browsers cannot set Authorization
      // on a WS handshake, and query strings leak credentials into server logs.
      const token = readAuthToken();
      this.ws = token ? new WebSocket(this.url, ['deepchart-token', token]) : new WebSocket(this.url);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.reconnectCount = 0;
        this.broadcast(l => l.onConnectionChange?.(true));
        this.startPing();
        this.startStaleChecker();
        this.notifyHealth();
        console.log('[DeepChart WS] Connected to server.');

        // Automatic resubscribe after reconnect
        if (this.activeSubscription) {
          this.subscriptionState = 'PENDING';
          this.send({
            type: 'SUBSCRIBE',
            symbol: this.activeSubscription.symbol,
            timeframe: this.activeSubscription.timeframe || '1m',
            source: this.activeSubscription.source,
          });
        }
      };

      this.ws.onmessage = (event) => {
        try {
          this.lastMessageTs = Date.now();
          const msg = JSON.parse(event.data) as WSServerMessage;

          const dispatch = (action: (l: WSListeners) => void) => {
            // Support backwards compatibility for this.listeners
            if (Object.keys(this.listeners).length > 0) {
              action(this.listeners);
            }
            for (const { symbol, listeners } of this.listenersMap.values()) {
              if (!msg.symbol || msg.symbol === symbol) {
                action(listeners);
              }
            }
          };

          switch (msg.type) {
            case 'INIT_STATE':
              this.subscriptionState = 'ACTIVE';
              this.notifyHealth();
              dispatch(l => l.onInitState?.(msg));
              break;
            case 'TICK':
              this.lastTradeTs = Date.now();
              this.notifyHealth();
              dispatch(l => l.onTick?.(msg.tick));
              break;
            case 'BAR_UPDATE':
              this.lastTradeTs = Date.now();
              dispatch(l => l.onBarUpdate?.(msg.bar));
              break;
            case 'BAR_CLOSE':
              this.lastTradeTs = Date.now();
              dispatch(l => l.onBarClose?.(msg.bar));
              break;
            case 'ORDERBOOK_UPDATE':
              dispatch(l => l.onOrderbookUpdate?.(msg.orderbook));
              break;
            case 'SPEED_OF_TAPE':
              dispatch(l => l.onSpeedOfTape?.(msg.tape));
              break;
            case 'DEEP_TRADE':
              this.lastTradeTs = Date.now();
              dispatch(l => l.onDeepTrade?.(msg.trade));
              break;
            case 'ABSORPTION':
              dispatch(l => l.onAbsorption?.(msg.alert));
              break;
            case 'PROFILE_UPDATE':
              dispatch(l => l.onProfileUpdate?.({ volumeProfile: msg.volumeProfile, tpo: msg.tpo }));
              break;
            case 'VWAP_UPDATE':
              dispatch(l => l.onVwapUpdate?.(msg.point));
              break;
            case 'GEX_UPDATE':
              dispatch(l => l.onGexUpdate?.(msg.profile));
              break;
            case 'OPTIONS_FLOW':
              dispatch(l => l.onOptionsFlow?.(msg.trade));
              break;
            case 'REPLAY_STATE':
              dispatch(l => l.onReplayState?.(msg.progress));
              break;
            case 'HISTORY_RESPONSE':
              dispatch(l => l.onHistoryResponse?.(msg));
              break;
            case 'PONG':
              if (this.pendingPing && (msg as any).timestamp === this.pendingPing.token) {
                const rtt = performance.now() - this.pendingPing.mono;
                this.pendingPing = null;
                if (Number.isFinite(rtt) && rtt >= 0) dispatch(l => l.onLatencyUpdate?.(Math.round(rtt)));
              }
              break;
            case 'ERROR':
              this.subscriptionState = 'ERROR';
              this.notifyHealth();
              dispatch(l => l.onError?.(msg));
              break;
            case 'ALERT_EVENT':
              dispatch(l => l.onAlert?.(msg.alert));
              break;
          }
        } catch (err) {
          console.error('[DeepChart WS] Error parsing message:', err);
        }
      };

      this.ws.onclose = (event: CloseEvent) => {
        this.stopPing();
        this.stopStaleChecker();
        this.isConnected = false;
        this.reconnectCount++;
        this.subscriptionState = 'UNSUBSCRIBED';
        this.broadcast(l => l.onConnectionChange?.(false));
        this.broadcast(l => l.onLatencyUpdate?.(0));
        this.notifyHealth();

        if (this.intentionalClose) {
          console.log('[DeepChart WS] Disconnected (intentional).');
          return;
        }

        const code = event?.code ?? 1006;
        const reason = event?.reason || '';
        if (code === 1008) {
          // Authentication / entitlement refused: retrying cannot help until the user signs in.
          console.warn(`[DeepChart WS] Server refused the session (${code}): ${reason}`);
          this.broadcast(l => l.onServerClose?.({ code, reason: reason || 'Not authorized' }));
          return;
        }
        if (code === 1013) {
          this.broadcast(l => l.onServerClose?.({ code, reason: reason || 'Server at capacity' }));
          console.log('[DeepChart WS] Server at capacity. Retrying in 15s...');
          this.reconnectTimer = setTimeout(() => this.connect(), 15000);
          return;
        }

        const backoffDelay = Math.min(30000, 1000 * Math.pow(2, this.reconnectCount));
        console.log(`[DeepChart WS] Disconnected. Reconnecting in ${backoffDelay}ms...`);
        this.reconnectTimer = setTimeout(() => this.connect(), backoffDelay);
      };

      this.ws.onerror = (err) => {
        console.error('[DeepChart WS] WebSocket error:', err);
      };
    } catch (err) {
      console.error('[DeepChart WS] Failed to initiate connection:', err);
    }
  }

  public send(msg: WSClientMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  public subscribe(symbol: string, source?: 'cme' | 'databento' | 'tradovate' | string, timeframe?: string) {
    const tf = timeframe || '1m';
    // Duplicate subscription prevention
    if (
      this.activeSubscription &&
      this.activeSubscription.symbol === symbol &&
      this.activeSubscription.source === source &&
      this.activeSubscription.timeframe === tf &&
      this.subscriptionState === 'ACTIVE' &&
      this.isConnected
    ) {
      return;
    }

    this.activeSubscription = { symbol, source, timeframe: tf };
    // The regular App listener follows the primary symbol; named secondary panes
    // retain their independent routes on the multiplexed connection.
    const primary = this.listenersMap.get('default');
    if (primary) primary.symbol = symbol;
    this.subscriptionState = 'PENDING';
    this.notifyHealth();

    this.send({
      type: 'SUBSCRIBE',
      symbol,
      timeframe: tf,
      source,
    });
  }

  public unsubscribe(symbol?: string) {
    if (this.activeSubscription && (!symbol || this.activeSubscription.symbol === symbol)) {
      this.send({ type: 'UNSUBSCRIBE', symbol: this.activeSubscription.symbol });
      this.activeSubscription = null;
      this.subscriptionState = 'UNSUBSCRIBED';
      this.notifyHealth();
    }
  }

  public controlReplay(action: 'START' | 'PAUSE' | 'SEEK' | 'SET_SPEED' | 'RETURN_TO_LIVE', speed?: number, timestamp?: number) {
    this.send({
      type: 'REPLAY_CONTROL',
      action,
      speed,
      timestamp,
    });
  }

  /** Advance the replay playhead by exactly one tick. */
  public stepReplay() {
    this.send({ type: 'REPLAY_CONTROL', action: 'STEP' });
  }

  /** Seek the replay playhead to a specific tick index or epoch timestamp. */
  public seekReplay(target: number) {
    this.controlReplay('SEEK', undefined, Math.floor(target));
  }

  /** Exit replay mode and return to the live market stream. */
  public returnToLive() {
    this.send({ type: 'REPLAY_CONTROL', action: 'RETURN_TO_LIVE' });
  }

  public fetchHistory(
    symbol: string,
    timeframe: string,
    beforeTime?: number,
    limit?: number,
    requestId?: string
  ) {
    this.send({
      type: 'FETCH_HISTORY',
      symbol,
      timeframe,
      beforeTime,
      limit,
      requestId,
    });
  }

  private startPing() {
    this.stopPing();
    const sendPing = () => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          const token = Date.now();
          this.pendingPing = { token, mono: performance.now() };
          this.ws.send(JSON.stringify({ type: 'PING', timestamp: token }));
        } catch {}
      }
    };
    sendPing();
    this.pingTimer = setInterval(sendPing, 5000);
  }

  private stopPing() {
    this.pendingPing = null;
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  public disconnect() {
    this.intentionalClose = true;
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }

    // Debounce close to prevent React 18 StrictMode double-mount from aborting
    // an in-flight handshake with "WebSocket is closed before the connection is established".
    this.disconnectTimer = setTimeout(() => {
      this.disconnectTimer = null;
      if (this.ws) {
        const socket = this.ws;
        this.ws = null;
        this.isConnected = false;
        this.broadcast(l => l.onConnectionChange?.(false));
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;

        if (socket.readyState === WebSocket.CONNECTING) {
          socket.onopen = () => {
            try { socket.close(); } catch {}
          };
        } else {
          try { socket.close(); } catch {}
        }
      }
    }, 50);
  }
}

export const wsClient = new DeepChartWSClient();


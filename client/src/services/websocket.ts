import {
  AbsorptionAlert,
  DeepTrade,
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
} from '../types';

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
  onReplayFrame?: (frame: { timestamp: number; price: number; volume: number; gex?: number | null; iv?: number | null; esPrice?: number | null; nqPrice?: number | null; signal?: any }) => void;
  onError?: (error: { code: string; message: string }) => void;
  onLatencyUpdate?: (latencyMs: number) => void;
}

export class DeepChartWSClient {
  private ws: WebSocket | null = null;
  private url: string;
  private listeners: WSListeners = {};
  private isConnected = false;
  private reconnectTimer: any = null;
  private disconnectTimer: any = null;
  private pingTimer: any = null;
  private intentionalClose = false;

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

  public setListeners(listeners: WSListeners) {
    this.listeners = listeners;
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
        this.listeners.onConnectionChange?.(true);
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
        this.listeners.onConnectionChange?.(true);
        this.startPing();
        console.log('[DeepChart WS] Connected to server.');
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WSServerMessage;
          switch (msg.type) {
            case 'INIT_STATE':
              this.listeners.onInitState?.(msg);
              break;
            case 'TICK':
              this.listeners.onTick?.(msg.tick);
              break;
            case 'BAR_UPDATE':
              this.listeners.onBarUpdate?.(msg.bar);
              break;
            case 'BAR_CLOSE':
              this.listeners.onBarClose?.(msg.bar);
              break;
            case 'ORDERBOOK_UPDATE':
              this.listeners.onOrderbookUpdate?.(msg.orderbook);
              break;
            case 'SPEED_OF_TAPE':
              this.listeners.onSpeedOfTape?.(msg.tape);
              break;
            case 'DEEP_TRADE':
              this.listeners.onDeepTrade?.(msg.trade);
              break;
            case 'ABSORPTION':
              this.listeners.onAbsorption?.(msg.alert);
              break;
            case 'PROFILE_UPDATE':
              this.listeners.onProfileUpdate?.({ volumeProfile: msg.volumeProfile, tpo: msg.tpo });
              break;
            case 'VWAP_UPDATE':
              this.listeners.onVwapUpdate?.(msg.point);
              break;
            case 'GEX_UPDATE':
              this.listeners.onGexUpdate?.(msg.profile);
              break;
            case 'OPTIONS_FLOW':
              this.listeners.onOptionsFlow?.(msg.trade);
              break;
            case 'REPLAY_STATE':
              this.listeners.onReplayState?.(msg.progress);
              break;
            case 'HISTORY_RESPONSE':
              this.listeners.onHistoryResponse?.(msg);
              break;
            case 'REPLAY_FRAME':
              this.listeners.onReplayFrame?.((msg as any).frame);
              break;
            case 'PONG':
              if (typeof (msg as any).timestamp === 'number') {
                const rtt = Math.max(1, Date.now() - (msg as any).timestamp);
                this.listeners.onLatencyUpdate?.(rtt);
              }
              break;
            case 'ERROR':
              this.listeners.onError?.(msg);
              break;
          }
        } catch (err) {
          console.error('[DeepChart WS] Error parsing message:', err);
        }
      };

      this.ws.onclose = (event: CloseEvent) => {
        this.stopPing();
        this.isConnected = false;
        this.listeners.onConnectionChange?.(false);
        this.listeners.onLatencyUpdate?.(0);
        if (this.intentionalClose) {
          console.log('[DeepChart WS] Disconnected (intentional).');
          return;
        }

        const code = event?.code ?? 1006;
        const reason = event?.reason || '';
        if (code === 1008) {
          // Authentication / entitlement refused: retrying cannot help until the user signs in.
          console.warn(`[DeepChart WS] Server refused the session (${code}): ${reason}`);
          this.listeners.onServerClose?.({ code, reason: reason || 'Not authorized' });
          return;
        }
        if (code === 1013) {
          this.listeners.onServerClose?.({ code, reason: reason || 'Server at capacity' });
          console.log('[DeepChart WS] Server at capacity. Retrying in 15s...');
          this.reconnectTimer = setTimeout(() => this.connect(), 15000);
          return;
        }

        console.log('[DeepChart WS] Disconnected. Reconnecting in 2s...');
        this.reconnectTimer = setTimeout(() => this.connect(), 2000);
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

  public subscribe(symbol: string, source?: 'databento' | 'binance' | string, timeframe?: string) {
    this.send({
      type: 'SUBSCRIBE',
      symbol,
      timeframe: timeframe || '1m',
      source,
    });
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
          this.ws.send(JSON.stringify({ type: 'PING', timestamp: Date.now() }));
        } catch {}
      }
    };
    sendPing();
    this.pingTimer = setInterval(sendPing, 5000);
  }

  private stopPing() {
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
        this.listeners.onConnectionChange?.(false);
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


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
}

export class DeepChartWSClient {
  private ws: WebSocket | null = null;
  private url: string;
  private listeners: WSListeners = {};
  private isConnected = false;
  private reconnectTimer: any = null;
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
    if (this.ws) {
      // Detach handlers from the previous socket first: otherwise its close event would
      // schedule a reconnect and leave two live connections. React StrictMode double-mounts
      // effects in dev, so this matters.
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
    }

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.listeners.onConnectionChange?.(true);
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
          }
        } catch (err) {
          console.error('[DeepChart WS] Error parsing message:', err);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.listeners.onConnectionChange?.(false);
        if (this.intentionalClose) {
          console.log('[DeepChart WS] Disconnected (intentional).');
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

  public subscribe(symbol: string, source?: 'binance' | 'simulator' | 'cme', timeframe?: string) {
    this.send({
      type: 'SUBSCRIBE',
      symbol,
      timeframe: timeframe || '1m',
      source,
    });
  }

  public controlReplay(action: 'START' | 'PAUSE' | 'SEEK' | 'SET_SPEED', speed?: number, timestamp?: number) {
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

  public disconnect() {
    this.intentionalClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
  }
}

export const wsClient = new DeepChartWSClient();


import {
  AbsorptionAlert,
  DeepTrade,
  FootprintBar,
  FuturesInstrument,
  GEXProfile,
  JournalTrade,
  OptionsFlowTrade,
  OrderbookSnapshot,
  PropAccountConfig,
  PropAccountState,
  ReplayProgress,
  RestingOrder,
  SlaveAccount,
  SpeedOfTapeData,
  TPOProfileData,
  Tick,
  TrailingMode,
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
    propState?: PropAccountState;
    propConfig?: PropAccountConfig;
    deepTradeThresholdUsd?: number;
    slaves?: SlaveAccount[];
    timeframe?: string;
  }) => void;
  onTick?: (tick: Tick) => void;
  onBarUpdate?: (bar: FootprintBar) => void;
  onBarClose?: (bar: FootprintBar) => void;
  onOrderbookUpdate?: (orderbook: OrderbookSnapshot) => void;
  onSpeedOfTape?: (tape: SpeedOfTapeData) => void;
  onDeepTrade?: (trade: DeepTrade) => void;
  onAbsorption?: (alert: AbsorptionAlert) => void;
  onTradeCopied?: (data: { slaveId: string; symbol: string; size: number; price: number; latencyMs: number }) => void;
  onJournalUpdate?: (trade: JournalTrade) => void;
  onGexUpdate?: (profile: GEXProfile) => void;
  onOptionsFlow?: (trade: OptionsFlowTrade) => void;
  onPropStateUpdate?: (state: PropAccountState) => void;
  onPropBreachAlert?: (data: { breachType: 'DAILY_LOSS' | 'MAX_DRAWDOWN'; message: string }) => void;
  onOpenOrders?: (data: { symbol: string; orders: RestingOrder[] }) => void;
  onOrderAck?: (data: { action: 'PLACED' | 'FILLED' | 'CANCELLED'; orderId?: string; price?: number; size?: number }) => void;
  onOrderReject?: (data: { reason: string; orderId?: string; size?: number }) => void;
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

  constructor(url = 'ws://localhost:8080') {
    this.url = url;
  }

  public setListeners(listeners: WSListeners) {
    this.listeners = listeners;
  }

  public connect() {
    this.intentionalClose = false;
    if (this.ws) {
      // Detach handlers from the previous socket first: otherwise its close event would
      // schedule a reconnect and leave two live connections (double messages / double
      // journal entries). React StrictMode double-mounts effects in dev, so this matters.
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
            case 'TRADE_COPIED':
              this.listeners.onTradeCopied?.(msg);
              break;
            case 'JOURNAL_UPDATE':
              this.listeners.onJournalUpdate?.(msg.trade);
              break;
            case 'GEX_UPDATE':
              this.listeners.onGexUpdate?.(msg.profile);
              break;
            case 'OPTIONS_FLOW':
              this.listeners.onOptionsFlow?.(msg.trade);
              break;
            case 'PROP_STATE_UPDATE':
              this.listeners.onPropStateUpdate?.(msg.state);
              break;
            case 'PROP_BREACH_ALERT':
              this.listeners.onPropBreachAlert?.(msg);
              break;
            case 'OPEN_ORDERS':
              this.listeners.onOpenOrders?.(msg);
              break;
            case 'ORDER_ACK':
              this.listeners.onOrderAck?.(msg);
              break;
            case 'ORDER_REJECT':
              this.listeners.onOrderReject?.(msg);
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

  public placeOrder(action: 'BUY' | 'SELL' | 'FLATTEN', size: number, price?: number, orderType: 'MARKET' | 'LIMIT' = 'MARKET') {
    this.send({
      type: 'DOM_ORDER',
      action,
      size,
      price,
      orderType,
    });
  }

  public subscribe(symbol: string, source?: 'binance' | 'simulator' | 'cme', timeframe?: string) {
    this.send({
      type: 'SUBSCRIBE',
      symbol,
      timeframe: timeframe || '1m',
      source,
    });
  }

  public setPropTrailingMode(mode: TrailingMode) {
    this.send({
      type: 'SET_PROP_TRAILING_MODE',
      mode,
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

  public updateCopier(slaves: SlaveAccount[]) {
    this.send({
      type: 'UPDATE_COPIER',
      slaves,
    });
  }

  /** Cancel a single resting order by id, or every resting order when id is omitted. */
  public cancelOrder(orderId?: string) {
    this.send({
      type: 'DOM_ORDER',
      action: 'CANCEL',
      size: 0,
      orderType: 'LIMIT',
      orderId,
    });
  }

  /** Advance the replay playhead by exactly one tick. */
  public stepReplay() {
    this.send({ type: 'REPLAY_CONTROL', action: 'STEP' });
  }

  /** Clear a prop-firm lockout (daily loss / drawdown breach). */
  public resetPropAccount() {
    this.send({ type: 'RESET_PROP_ACCOUNT' });
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

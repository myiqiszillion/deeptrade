import React, { useEffect, useRef, useState } from 'react';
import { wsClient } from './services/websocket';
import {
  AbsorptionAlert,
  ChartViewport,
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
} from './types';
import { FootprintCanvas } from './components/Chart/FootprintCanvas';
import { CVDPanel } from './components/Chart/CVDPanel';
import { AuthPanel } from './components/Auth/AuthPanel';
import {
  AuthConfigResponse,
  clearStoredToken,
  deepchartApi,
  hasStoredToken,
  PlanSummary,
} from './services/api';
import { TerminalHeader } from './components/Navigation/TerminalHeader';
import { ChartToolbar, SignalFilters } from './components/Navigation/ChartToolbar';
import { TerminalStatusBar } from './components/Status/TerminalStatusBar';
import { InstrumentOption } from './components/Navigation/SymbolDropdown';
import { CommandPalette, OverlayKey, PanelId } from './components/CommandPalette';
import { ToolRail } from './components/Layout/ToolRail';
import { ChartLegend } from './components/Chart/ChartLegend';
import { MarketWatch } from './components/Navigation/MarketWatch';
import { rememberSymbol } from './services/symbolPrefs';
import { Activity, BookOpen, Search, X } from 'lucide-react';

// Heavy surfaces that are not part of the first paint are code-split: the terminal stays usable while the
// analytics dock / modals / replay bar load, and the initial bundle stays small.
const WorkspaceDock = React.lazy(() =>
  import('./components/Navigation/WorkspaceDock').then((m) => ({ default: m.WorkspaceDock }))
);
const SystemStatusModal = React.lazy(() =>
  import('./components/Status/SystemStatusModal').then((m) => ({ default: m.SystemStatusModal }))
);
const OnboardingCard = React.lazy(() =>
  import('./components/Help/OnboardingCard').then((m) => ({ default: m.OnboardingCard }))
);
const TickReplayWidget = React.lazy(() =>
  import('./components/Backtest/TickReplayWidget').then((m) => ({ default: m.TickReplayWidget }))
);
const CockpitDashboard = React.lazy(() =>
  import('./components/Cockpit/CockpitDashboard').then((m) => ({ default: m.CockpitDashboard }))
);

/** Placeholder that keeps the layout from jumping while a lazy panel streams in. */
const PanelSkeleton: React.FC<{ className?: string }> = ({ className }) => (
  <div className={className} aria-hidden="true">
    <div className="dc-skeleton h-full w-full opacity-40" />
  </div>
);

const POPULAR_FUTURES = [
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF' },
  { symbol: 'QQQ', name: 'Invesco QQQ Trust' },
  { symbol: 'IWM', name: 'iShares Russell 2000 ETF' },
  { symbol: 'SPX', name: 'S&P 500 Index' },
  { symbol: 'NDX', name: 'Nasdaq 100 Index' },
  { symbol: 'VIX', name: 'CBOE Volatility Index' },
  { symbol: 'AAPL', name: 'Apple Inc.' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.' },
  { symbol: 'TSLA', name: 'Tesla, Inc.' },
  { symbol: 'MSFT', name: 'Microsoft Corp.' },
  { symbol: 'MSTR', name: 'MicroStrategy Inc.' },
  { symbol: 'COIN', name: 'Coinbase Global Inc.' },
  { symbol: 'ES', name: 'E-mini S&P 500 (CME Globex)' },
  { symbol: 'NQ', name: 'E-mini Nasdaq 100 (CME Globex)' },
  { symbol: 'MES', name: 'Micro E-mini S&P 500 (CME)' },
  { symbol: 'MNQ', name: 'Micro E-mini Nasdaq 100 (CME)' },
  { symbol: 'YM', name: 'E-mini Dow Jones (CBOT)' },
  { symbol: 'RTY', name: 'E-mini Russell 2000 (CME)' },
  { symbol: 'GC', name: 'Gold Futures (COMEX)' },
  { symbol: 'CL', name: 'Crude Oil (NYMEX)' },
  { symbol: 'NG', name: 'Natural Gas (NYMEX)' },
  { symbol: 'BTC', name: 'Bitcoin' },
  { symbol: 'ETH', name: 'Ethereum' },
  { symbol: 'SOL', name: 'Solana' },
  { symbol: 'DOGE', name: 'Dogecoin' }
];

const SETTINGS_STORAGE_KEY = 'deepchart_free_settings_v1';

interface SavedSettings {
  activePanel?: 'DOM' | 'Profile' | 'Tape' | 'GEX' | 'Flow' | 'Darkpool' | '13F' | null;
  dockMode?: 'split' | 'single';
  symbol?: string;
  timeframe?: string;
  chartMode?: 'footprint' | 'candles';
  clusterMultiplier?: 'auto' | 1 | 2 | 4 | 5 | 10 | 25 | 50;
  showDOM?: boolean;
  showProfile?: boolean;
  showTape?: boolean;
  showGEX?: boolean;
  showOptionsFlow?: boolean;
  showVWAP?: boolean;
  showImbalances?: boolean;
  showDeltaNumbers?: boolean;
  showCVD?: boolean;
  cvdHeight?: number;
  signalFilters?: SignalFilters;
}

function loadSavedSettings(): SavedSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

function saveSettings(settings: SavedSettings) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {}
}

const MAX_CLIENT_BARS = 1000;

/**
 * Pre-live history is kept in its own, larger budget: it is paged in from the server and must not be
 * trimmed by the live-footprint cap, otherwise the chart silently forgets candles it already loaded.
 */
const MAX_CLIENT_HISTORY_BARS = 5000;

/** Merge two pre-live bar series by open time, keeping the newest MAX_CLIENT_HISTORY_BARS bars. */
function mergeHistorySeries(a: HistoricalBar[], b: HistoricalBar[]): HistoricalBar[] {
  const byTime = new Map<number, HistoricalBar>();
  for (const bar of a) byTime.set(bar.time, bar);
  for (const bar of b) byTime.set(bar.time, bar);
  const merged = Array.from(byTime.values()).sort((x, y) => x.time - y.time);
  return merged.length > MAX_CLIENT_HISTORY_BARS ? merged.slice(-MAX_CLIENT_HISTORY_BARS) : merged;
}

/** HISTORY_RESPONSE carries its cursor either as a raw number or as an object with `beforeTime`. */
function readHistoryCursor(cursor: unknown): number | null {
  if (typeof cursor === 'number' && Number.isFinite(cursor)) return cursor;
  if (cursor && typeof cursor === 'object') {
    const beforeTime = (cursor as { beforeTime?: unknown }).beforeTime;
    if (typeof beforeTime === 'number' && Number.isFinite(beforeTime)) return beforeTime;
  }
  return null;
}

/** Insert or replace a footprint bar, keeping the series ordered by bar open time and bounded to MAX_CLIENT_BARS. */
function mergeBar(bars: FootprintBar[], bar: FootprintBar): FootprintBar[] {
  if (bars.length === 0) return [bar];
  const lastIdx = bars.length - 1;
  // Fast path: update current active bar (overwhelming majority of ticks)
  if (bars[lastIdx].id === bar.id) {
    const next = [...bars];
    next[lastIdx] = bar;
    return next;
  }
  // Fast path: new bar appended at the end
  if (bar.time >= bars[lastIdx].time) {
    const next = [...bars, bar];
    return next.length > MAX_CLIENT_BARS ? next.slice(next.length - MAX_CLIENT_BARS) : next;
  }
  // Fallback: bar belongs to an earlier index (e.g. late tick updating previous bar)
  const idx = bars.findIndex((b) => b.id === bar.id);
  if (idx !== -1) {
    const next = [...bars];
    next[idx] = bar;
    return next;
  }
  const next = [...bars, bar].sort((a, b) => a.time - b.time);
  return next.length > MAX_CLIENT_BARS ? next.slice(next.length - MAX_CLIENT_BARS) : next;
}

export const App: React.FC = () => {
  const [savedSettings] = useState<SavedSettings>(loadSavedSettings);

  const [isConnected, setIsConnected] = useState(false);

  /* ---------------------------------------------------------------- Authentication */
  const [authConfig, setAuthConfig] = useState<AuthConfigResponse | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<{ username: string; role: string } | null>(null);
  const [sessionPlan, setSessionPlan] = useState<PlanSummary | null>(null);

  // Load the public auth configuration once: it decides whether the login screen is required.
  useEffect(() => {
    let cancelled = false;
    deepchartApi
      .getAuthConfig()
      .then((config) => {
        if (!cancelled) setAuthConfig(config);
      })
      .catch(() => {
        if (!cancelled) setAuthConfig(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // When a token exists, surface who is signed in and which plan is in force.
  useEffect(() => {
    if (!hasStoredToken()) return;
    let cancelled = false;
    deepchartApi
      .getMe()
      .then((me) => {
        if (cancelled) return;
        setCurrentUser({ username: me.user?.username ?? 'user', role: me.user?.role ?? 'user' });
        if (me.plan) setSessionPlan(me.plan);
      })
      .catch(() => {
        // Expired/revoked token: drop it so the login screen comes back.
        clearStoredToken();
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAuthenticate = async (username: string, password: string) => {
    await deepchartApi.login(username, password);
    window.location.reload();
  };

  const handleRegister = async (username: string, password: string) => {
    await deepchartApi.register(username, password);
    window.location.reload();
  };

  const handleLogout = async () => {
    await deepchartApi.logout();
    window.location.reload();
  };

  const handleStartCheckout = async (planId: string) => {
    try {
      const { url } = await deepchartApi.startCheckout(planId);
      window.location.href = url;
    } catch (err) {
      setAuthNotice(err instanceof Error ? err.message : 'Checkout is unavailable');
    }
  };

  const [symbol, setSymbol] = useState(
    savedSettings.symbol && !savedSettings.symbol.includes('USDT') ? savedSettings.symbol : 'ES'
  );
  const [instrument, setInstrument] = useState<FuturesInstrument | undefined>();
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [chartMode, setChartMode] = useState<'footprint' | 'candles'>(savedSettings.chartMode || 'footprint');

  // Synchronized Viewport & Crosshair across Chart & CVD
  const [viewport, setViewport] = useState<ChartViewport>({
    panX: 0,
    panY: 300,
    barWidth: 70,
    barSpacing: 10,
    priceScale: 16,
    autoFollow: true,
  });
  const [crosshairX, setCrosshairX] = useState<number | null>(null);
  const [cvdHeight, setCvdHeight] = useState<number>(savedSettings.cvdHeight ?? 85);

  // Core Data State
  const [bars, setBars] = useState<FootprintBar[]>([]);
  const [orderbook, setOrderbook] = useState<OrderbookSnapshot>({
    bids: [],
    asks: [],
    timestamp: 0,
    lastUpdateId: 0,
  });
  const [volumeProfile, setVolumeProfile] = useState<VolumeProfileData>({
    poc: 0,
    vah: 0,
    val: 0,
    totalVolume: 0,
    levels: [],
  });
  const [tpoProfile, setTpoProfile] = useState<TPOProfileData>({
    poc: 0,
    vah: 0,
    val: 0,
    initialBalance: { high: 0, low: 0 },
    brackets: [],
    priceLevels: {},
  });
  const [vwapPoints, setVwapPoints] = useState<VWAPPoint[]>([]);
  const [currentCVD, setCurrentCVD] = useState<number>(0);
  const [tape, setTape] = useState<SpeedOfTapeData>({
    tps: 0,
    volumePerSec: 0,
    buyRatio: 0.5,
    acceleration: 0,
  });
  const [recentTicks, setRecentTicks] = useState<Tick[]>([]);
  const [deepTrades, setDeepTrades] = useState<DeepTrade[]>([]);
  const [absorptions, setAbsorptions] = useState<AbsorptionAlert[]>([]);

  // GEX & Options Flow State
  const [gexProfile, setGexProfile] = useState<GEXProfile | undefined>();
  const [optionsFlow, setOptionsFlow] = useState<OptionsFlowTrade[]>([]);

  // Replay protocol state
  const [replayProgress, setReplayProgress] = useState<ReplayProgress | undefined>();
  const [replayFrame, setReplayFrame] = useState<{ timestamp: number; price: number; volume: number; gex?: number | null; iv?: number | null; esPrice?: number | null; nqPrice?: number | null; signal?: any } | null>(null);
  const [sessionMode, setSessionMode] = useState<'LIVE' | 'REPLAY' | 'REPLAY_PAUSED' | 'REPLAY_ENDED'>('LIVE');
  const [deepTradeThresholdUsd, setDeepTradeThresholdUsd] = useState<number | undefined>();
  const [historySource, setHistorySource] = useState<'NONE' | 'REAL_TICKS' | 'REAL_BARS'>('NONE');
  // REAL vendor bars from before the live session. Plain candles: no per-price footprint exists
  // for them, and the server never fabricates one.
  const [historyBars, setHistoryBars] = useState<HistoricalBar[]>([]);
  const [feedStatus, setFeedStatus] = useState<'LIVE' | 'UNAVAILABLE'>('UNAVAILABLE');

  // High-frequency tick buffering: ticks arrive every 30-120ms. Buffering them and
  // flushing to React state at ~8Hz keeps the Time & Sales tape lossless while cutting
  // the number of full component-tree re-renders.
  const pendingTicksRef = useRef<Tick[]>([]);
  const lastPriceRef = useRef<number | null>(null);
  const symbolRef = useRef(
    savedSettings.symbol && !savedSettings.symbol.includes('USDT') ? savedSettings.symbol : 'ES'
  );
  const desiredSymbolRef = useRef(
    savedSettings.symbol && !savedSettings.symbol.includes('USDT') ? savedSettings.symbol : 'ES'
  );
  const timeframeRef = useRef(savedSettings.timeframe || '1m');

  // History pagination state
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const oldestBarTimeRef = useRef<number | null>(null);
  const isLoadingHistoryRef = useRef(false);
  const hasMoreHistoryRef = useRef(true);
  /**
   * Cursor for the next "load older" page. It comes from the server response (which points just
   * before the oldest row it returned) — scanning `historyBars[0].time` instead stalls as soon as
   * the array is trimmed at the cap, because the cursor can then never move further back.
   */
  const historyCursorRef = useRef<number | null>(null);
  const lastHistoryRequestRef = useRef<number | null>(null);
  /** 'SYMBOL|timeframe' of the series on screen: a refresh INIT of the same series must merge. */
  const historySeriesKeyRef = useRef<string>('');

  // Features & Panels Toggles (restored from browser storage)
  const [activePanel, setActivePanel] = useState<SavedSettings['activePanel']>(
    savedSettings.activePanel === null ? null :
      ['DOM', 'Profile', 'Tape', 'GEX', 'Flow', 'Darkpool', '13F'].includes(savedSettings.activePanel ?? '') ? savedSettings.activePanel : 'DOM'
  );
  const [instrumentsList, setInstrumentsList] = useState<InstrumentOption[]>(POPULAR_FUTURES);
  const [showSystemStatus, setShowSystemStatus] = useState(false);
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'chart' | 'cockpit'>(() => {
    try {
      return (localStorage.getItem('deepchart_view_mode') as 'chart' | 'cockpit') || 'chart';
    } catch {
      return 'chart';
    }
  });

  const handleToggleViewMode = () => {
    setViewMode((prev) => {
      const next = prev === 'chart' ? 'cockpit' : 'chart';
      try {
        localStorage.setItem('deepchart_view_mode', next);
      } catch {}
      return next;
    });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      if (e.key === 'm' || e.key === 'M') {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          handleToggleViewMode();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
  // Layout is persisted together: which side the dock sits on and whether the watchlist is open.
  const [dockSide, setDockSide] = useState<'left' | 'right'>(() => {
    try {
      const raw = localStorage.getItem('deepchart_layout_v1');
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed?.dockSide === 'left' ? 'left' : 'right';
    } catch {
      return 'right';
    }
  });
  const [showWatchlist, setShowWatchlist] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem('deepchart_layout_v1');
      const parsed = raw ? JSON.parse(raw) : null;
      return Boolean(parsed?.showWatchlist);
    } catch {
      return false;
    }
  });
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem('deepchart_layout_v1', JSON.stringify({ dockSide, showWatchlist }));
    } catch {
      /* layout preference is a convenience; ignore storage failures */
    }
  }, [dockSide, showWatchlist]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const [showHelp, setShowHelp] = useState(false);
  const [showReplay, setShowReplay] = useState(false);
  const [showCVD, setShowCVD] = useState(savedSettings.showCVD ?? true);
  const [showVWAP, setShowVWAP] = useState(savedSettings.showVWAP ?? true);
  const [showImbalances, setShowImbalances] = useState(savedSettings.showImbalances ?? true);
  const [showDeltaNumbers, setShowDeltaNumbers] = useState(savedSettings.showDeltaNumbers ?? true);
  const [clusterMultiplier, setClusterMultiplier] = useState<'auto' | 1 | 2 | 4 | 5 | 10 | 25 | 50>(
    savedSettings.clusterMultiplier ?? 'auto'
  );
  const [timeframe, setTimeframe] = useState(savedSettings.timeframe || '1m');
  const [signalFilters, setSignalFilters] = useState<SignalFilters>(
    savedSettings.signalFilters ?? {
      buyAbs: true,
      sellAbs: true,
      gamma: true,
      whale: true,
    }
  );
  const [tickCount, setTickCount] = useState<number>(0);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  // Load dynamic instrument capabilities from the server, and refresh them when the active symbol or feed
  // state changes so the picker's LIVE / CONNECTING / IDLE badges reflect reality instead of a stale poll.
  useEffect(() => {
    let cancelled = false;
    deepchartApi
      .getInstruments()
      .then((list) => {
        if (cancelled || !list || list.length === 0) return;
        setInstrumentsList(
          list.map((i) => ({
            symbol: i.symbol,
            name: i.name,
            exchange: i.exchange,
            category: i.category,
            tickSize: i.tickSize,
            pointValue: i.pointValue,
            dayTradingMargin: i.dayTradingMargin,
            isLive: i.isLive,
            feedStatus: i.feedStatus,
            subscribed: i.subscribed,
            feedConfigured: i.feedConfigured,
          }))
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [symbol, feedStatus]);

  // Terminal keyboard shortcuts. Ctrl/Cmd+K owns the palette; the single-letter keys are ignored while a
  // text field is focused, so they can never steal keystrokes from search or login inputs.
  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null;
      if (!el || !el.tagName) return false;
      const tag = el.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 'k') {
        event.preventDefault();
        setPaletteOpen((prev) => !prev);
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      // "/" is the TradingView-style symbol search: same palette, one keystroke.
      if (event.key === '/') {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }

      switch (key) {
        case 'f':
          setChartMode((prev) => (prev === 'footprint' ? 'candles' : 'footprint'));
          break;
        case 'v':
          setShowVWAP((prev) => !prev);
          break;
        case 'i':
          setShowImbalances((prev) => !prev);
          break;
        case 'd':
          setShowDeltaNumbers((prev) => !prev);
          break;
        case 'c':
          setShowCVD((prev) => !prev);
          break;
        case 'p':
          setActivePanel((prev) => (prev ? null : 'DOM'));
          break;
        case 'r':
          setShowReplay((prev) => !prev);
          break;
        case 's':
          setShowSystemStatus((prev) => !prev);
          break;
        case '?':
          setShowHelp((prev) => !prev);
          break;
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7': {
          const panels = ['DOM', 'Profile', 'Tape', 'GEX', 'Flow', 'Darkpool', '13F'] as const;
          const target = panels[Number(key) - 1];
          setActivePanel((prev) => (prev === target ? null : target));
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Persist user preferences to localStorage
  useEffect(() => {
    saveSettings({
      symbol,
      timeframe,
      chartMode,
      clusterMultiplier,
      activePanel,
      showVWAP,
      showImbalances,
      showDeltaNumbers,
      showCVD,
      cvdHeight,
      signalFilters,
    });
  }, [
    symbol,
    timeframe,
    chartMode,
    clusterMultiplier,
    activePanel,
    showVWAP,
    showImbalances,
    showDeltaNumbers,
    showCVD,
    cvdHeight,
    signalFilters,
  ]);

  // Screen-reader announcement for state a sighted trader reads from colour alone: symbol, feed and replay
  // state. Kept out of the visual tree (sr-only) so it never crowds the chart.
  const liveAnnouncement =
    `${symbol} · ${timeframe} · feed ${feedStatus === 'LIVE' ? 'live' : 'unavailable'}` +
    (sessionMode === 'LIVE' ? '' : ` · replay ${sessionMode.replaceAll('_', ' ').toLowerCase()}`);

  // Connect WebSocket & Register Listeners
  useEffect(() => {
    wsClient.setListeners({
      // Server-initiated refusals need product UI: 1008 = sign-in/entitlement, 1013 = capacity.
      onServerClose: ({ code, reason }) => {
        setAuthNotice(
          code === 1008
            ? `Session refused: ${reason}. Sign in again to continue.`
            : `Server is at capacity: ${reason}`
        );
      },
      onLatencyUpdate: (lat) => {
        setLatencyMs(lat > 0 ? lat : null);
      },
      onConnectionChange: (connected) => {
        setIsConnected(connected);
        if (!connected) {
          setFeedStatus('UNAVAILABLE');
          setLatencyMs(null);
        }
      },
      onInitState: (data) => {
        // After a reconnect the server may be back on its default contract or timeframe. Ask it to
        // switch instead of silently reverting the UI.
        if (data.symbol !== desiredSymbolRef.current || (data.timeframe && data.timeframe !== timeframeRef.current)) {
          wsClient.subscribe(
            desiredSymbolRef.current,
            'databento',
            timeframeRef.current
          );
          return;
        }

        // A symbol switch (or reconnect) must reset per-instrument market state,
        // otherwise bars/tape from the previous contract stay on screen.
        if (data.symbol !== symbolRef.current) {
          symbolRef.current = data.symbol;
          setBars([]);
          setVolumeProfile({ poc: 0, vah: 0, val: 0, totalVolume: 0, levels: [] });
          setTpoProfile({ poc: 0, vah: 0, val: 0, initialBalance: { high: 0, low: 0 }, brackets: [], priceLevels: {} });
        }
        pendingTicksRef.current = [];
        setRecentTicks([]);
        setDeepTrades([]);
        setAbsorptions([]);
        setTape({ tps: 0, volumePerSec: 0, buyRatio: 0.5, acceleration: 0 });
        if (data.mode) {
          setSessionMode(data.mode);
        } else {
          setSessionMode('LIVE');
        }
        if (data.mode === 'LIVE') {
          setReplayProgress(undefined);
        }

        setSymbol(data.symbol);
        setInstrument(data.instrument);
        if (typeof data.deepTradeThresholdUsd === 'number') setDeepTradeThresholdUsd(data.deepTradeThresholdUsd);
        setHistorySource(data.historySource ?? 'NONE');
        {
          const incomingHistory = data.historyBars ?? [];
          const seriesKey = `${data.symbol}|${data.timeframe ?? ''}`;
          if (seriesKey !== historySeriesKeyRef.current) {
            // New symbol/timeframe: this snapshot is the complete series.
            historySeriesKeyRef.current = seriesKey;
            historyCursorRef.current = incomingHistory.length > 0 ? incomingHistory[0].time : null;
            lastHistoryRequestRef.current = null;
            setHistoryBars(incomingHistory);
          } else if (incomingHistory.length > 0) {
            // Refresh snapshot of the same series (async backfill, re-subscribe): merge so history the
            // user already paged in is not thrown away.
            setHistoryBars((prev) => mergeHistorySeries(prev, incomingHistory));
          }
        }
        if (data.feedStatus) setFeedStatus(data.feedStatus);
        if (data.timeframe) {
          timeframeRef.current = data.timeframe;
          setTimeframe(data.timeframe);
        }
        setBars(data.bars);
        setOrderbook(data.orderbook);
        setVolumeProfile(data.volumeProfile);
        setTpoProfile(data.tpo);
        setVwapPoints(data.vwap);
        setGexProfile(data.gexProfile);
        setOptionsFlow(data.optionsFlow ?? []);

        const latestBar = data.bars && data.bars.length > 0 ? data.bars[data.bars.length - 1] : null;
        setCurrentCVD(latestBar ? latestBar.cvd : 0);

        let resolvedPrice = 0;
        if (data.orderbook && data.orderbook.asks && data.orderbook.asks[0]) {
          resolvedPrice = data.orderbook.asks[0].price;
        } else if (data.bars && data.bars.length > 0) {
          resolvedPrice = data.bars[data.bars.length - 1].close;
        } else if (data.historyBars && data.historyBars.length > 0) {
          resolvedPrice = data.historyBars[data.historyBars.length - 1].close;
        }
        setCurrentPrice(resolvedPrice);
        lastPriceRef.current = resolvedPrice > 0 ? resolvedPrice : null;
      },
      onTick: (tick) => {
        pendingTicksRef.current.unshift(tick);
        lastPriceRef.current = tick.price;
        setTickCount((prev) => prev + 1);
      },
      onBarUpdate: (bar) => {
        setBars((prev) => {
          const merged = mergeBar(prev, bar);
          if (merged.length > 0 && merged[merged.length - 1].id === bar.id) {
            setCurrentCVD(bar.cvd);
          }
          return merged;
        });
      },
      onBarClose: (bar) => {
        setBars((prev) => {
          const merged = mergeBar(prev, bar);
          if (merged.length > 0 && merged[merged.length - 1].id === bar.id) {
            setCurrentCVD(bar.cvd);
          }
          return merged;
        });
      },
      onOrderbookUpdate: (book) => {
        setOrderbook(book);
      },
      onSpeedOfTape: (t) => {
        setTape(t);
      },
      onDeepTrade: (dt) => {
        setDeepTrades((prev) => [dt, ...prev.slice(0, 20)]);
      },
      onAbsorption: (abs) => {
        setAbsorptions((prev) => [abs, ...prev.slice(0, 10)]);
      },
      onProfileUpdate: (data) => {
        setVolumeProfile(data.volumeProfile);
        if (data.tpo) setTpoProfile(data.tpo);
      },
      onVwapUpdate: (point) => {
        setVwapPoints((prev) => {
          const updated = [...prev, point];
          return updated.length > 500 ? updated.slice(-500) : updated;
        });
      },
      onGexUpdate: (gp) => {
        setGexProfile(gp);
      },
      onOptionsFlow: (flow) => {
        setOptionsFlow((prev) => [flow, ...prev.slice(0, 50)]);
      },
      onReplayState: (progress) => {
        setReplayProgress(progress);
        if (progress.mode) {
          setSessionMode(progress.mode);
        } else if (progress.isPlaying) {
          setSessionMode('REPLAY');
        } else if (progress.isEnded) {
          setSessionMode('REPLAY_ENDED');
        } else {
          setSessionMode('REPLAY_PAUSED');
        }
      },
      onReplayFrame: (frame) => setReplayFrame(frame),
      onHistoryResponse: (resp) => {
        isLoadingHistoryRef.current = false;
        setIsLoadingHistory(false);
        if (resp.symbol !== symbolRef.current || resp.timeframe !== timeframeRef.current) {
          return; // Ignore stale response from earlier symbol/timeframe
        }
        const nextCursor = readHistoryCursor(resp.cursor);
        if (nextCursor !== null) {
          historyCursorRef.current = nextCursor;
        }
        if (!resp.hasMore || resp.bars.length === 0) {
          hasMoreHistoryRef.current = false;
          setHasMoreHistory(false);
        }
        if (resp.hasMore && resp.bars.length > 0) {
          hasMoreHistoryRef.current = true;
          setHasMoreHistory(true);
        }
        if (resp.bars.length > 0) {
          setHistoryBars((prev) => mergeHistorySeries(prev, resp.bars));
        }
      },
    });

    const flushTimer = setInterval(() => {
      const pending = pendingTicksRef.current;
      if (pending.length === 0) return;
      pendingTicksRef.current = [];
      setRecentTicks((prev) => [...pending, ...prev].slice(0, 100));
      if (lastPriceRef.current !== null) {
        setCurrentPrice(lastPriceRef.current);
        setFeedStatus('LIVE');
      }
    }, 120);

    wsClient.connect();
    return () => {
      clearInterval(flushTimer);
      wsClient.disconnect();
    };
  }, []);

  const handleSelectSymbol = (sym: string) => {
    rememberSymbol(sym); // feeds the "Recent" group in the command palette and picker
    desiredSymbolRef.current = sym;
    symbolRef.current = sym;
    pendingTicksRef.current = [];
    oldestBarTimeRef.current = null;
    hasMoreHistoryRef.current = true;
    isLoadingHistoryRef.current = false;
    historyCursorRef.current = null;
    lastHistoryRequestRef.current = null;
    historySeriesKeyRef.current = '';
    setHasMoreHistory(true);
    setIsLoadingHistory(false);
    setSymbol(sym);
    setFeedStatus('UNAVAILABLE');
    setHistorySource('NONE');
    setOrderbook({ bids: [], asks: [], timestamp: 0, lastUpdateId: 0 });
    setVolumeProfile({ poc: 0, vah: 0, val: 0, totalVolume: 0, levels: [] });
    setTpoProfile({ poc: 0, vah: 0, val: 0, initialBalance: { high: 0, low: 0 }, brackets: [], priceLevels: {} });
    setCurrentCVD(0);
    setVwapPoints([]);
    setBars([]);
    setHistoryBars([]);
    setCurrentPrice(0);
    lastPriceRef.current = null;
    setGexProfile(undefined);
    setOptionsFlow([]);
    setDeepTrades([]);
    setAbsorptions([]);
    setRecentTicks([]);
    setTape({ tps: 0, volumePerSec: 0, buyRatio: 0.5, acceleration: 0 });
    setViewport((prev) => ({ ...prev, anchorPrice: undefined, autoFollow: true }));
    const src = 'databento';
    wsClient.subscribe(sym, src, timeframeRef.current);
  };

  const handleTimeframeChange = (tf: string) => {
    timeframeRef.current = tf;
    oldestBarTimeRef.current = null;
    hasMoreHistoryRef.current = true;
    isLoadingHistoryRef.current = false;
    historyCursorRef.current = null;
    lastHistoryRequestRef.current = null;
    historySeriesKeyRef.current = '';
    setHasMoreHistory(true);
    setIsLoadingHistory(false);
    setTimeframe(tf);
    const src = 'databento';
    wsClient.subscribe(desiredSymbolRef.current, src, tf);
  };

  // Trigger historical backfill when viewport is panned near the oldest available bar
  useEffect(() => {
    if (isLoadingHistoryRef.current || !hasMoreHistoryRef.current) return;
    if (bars.length === 0 && historyBars.length === 0) return;

    const totalLeftBars = historyBars.length;
    const barStep = viewport.barWidth + viewport.barSpacing;
    const oldestBarScreenX = viewport.panX - totalLeftBars * barStep;

    if (oldestBarScreenX > -300) {
      // Page with the server cursor. It always points just before the oldest row the server returned,
      // so it keeps moving back even after the client trims its own array at MAX_CLIENT_HISTORY_BARS.
      const cursor =
        historyCursorRef.current ??
        (historyBars.length > 0 ? historyBars[0].time : bars[0]?.time ?? null);
      if (cursor !== null && cursor !== lastHistoryRequestRef.current) {
        lastHistoryRequestRef.current = cursor;
        oldestBarTimeRef.current = cursor;
        isLoadingHistoryRef.current = true;
        setIsLoadingHistory(true);
        wsClient.fetchHistory(symbolRef.current, timeframeRef.current, cursor, 300);
      }
    }
  }, [viewport.panX, viewport.barWidth, viewport.barSpacing, historyBars, bars]);

  const sessionStats = React.useMemo(() => {
    let high = -Infinity;
    let low = Infinity;
    for (const b of bars) {
      if (typeof b.high === 'number' && Number.isFinite(b.high) && b.high > high) high = b.high;
      if (typeof b.low === 'number' && Number.isFinite(b.low) && b.low < low) low = b.low;
    }
    for (const b of historyBars) {
      if (typeof b.high === 'number' && Number.isFinite(b.high) && b.high > high) high = b.high;
      if (typeof b.low === 'number' && Number.isFinite(b.low) && b.low < low) low = b.low;
    }
    return {
      high: high > -Infinity ? high : undefined,
      low: low < Infinity ? low : undefined,
    };
  }, [bars, historyBars]);

  const handleToggleSignalFilter = (key: keyof SignalFilters) => {
    setSignalFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleToggleAutoFollow = () => {
    setViewport((prev) => ({ ...prev, autoFollow: !prev.autoFollow }));
  };

  const handleFitView = () => {
    setViewport((prev) => ({
      ...prev,
      panX: 0,
      barWidth: 80,
      autoFollow: true,
      anchorPrice: undefined,
    }));
  };

  const handleZoomIn = () => {
    setViewport((prev) => ({
      ...prev,
      barWidth: Math.min(280, Math.round(prev.barWidth * 1.2)),
    }));
  };

  const handleZoomOut = () => {
    setViewport((prev) => ({
      ...prev,
      barWidth: Math.max(40, Math.round(prev.barWidth * 0.82)),
    }));
  };

  const handleScreenshot = () => {
    // Capture whatever the chart surface currently renders (the footprint canvas) as a PNG download.
    const canvas = document.querySelector<HTMLCanvasElement>('#chart-surface canvas');
    if (!canvas) {
      setAuthNotice('Chart image: nothing to capture yet (no chart rendered).');
      return;
    }
    try {
      const url = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = url;
      link.download = `deepchart-${symbol}-${timeframe}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.png`;
      link.click();
    } catch (err) {
      setAuthNotice(`Chart image failed: ${(err as Error).message}`);
    }
  };

  const handleToggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void document.documentElement.requestFullscreen?.();
    }
  };

  /** Single owner of the overlay toggles, shared by the palette, the legend chips and the toolbar. */
  const toggleOverlay = (key: OverlayKey) => {
    if (key === 'vwap') setShowVWAP((prev) => !prev);
    else if (key === 'imbalances') setShowImbalances((prev) => !prev);
    else if (key === 'delta') setShowDeltaNumbers((prev) => !prev);
    else setShowCVD((prev) => !prev);
  };

  /** Digits to show for this instrument: 0.25 -> 2, 0.0005 -> 4, 1 -> 0 (never more than 6). */
  const decimalsForTick = (tick?: number): number => {
    if (!tick || !Number.isFinite(tick) || tick <= 0) return 2;
    return Math.max(0, Math.min(6, Math.ceil(-Math.log10(tick))));
  };

  const lastRenderedBar = React.useMemo(() => {
    const source = bars.length > 0 ? bars : historyBars;
    const bar = source[source.length - 1];
    if (!bar) return undefined;
    return { open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume };
  }, [bars, historyBars]);

  const previousBarClose = React.useMemo(() => {
    const source = bars.length > 0 ? bars : historyBars;
    return source.length > 1 ? source[source.length - 2].close : undefined;
  }, [bars, historyBars]);

  // Command palette wiring: every entry maps to a handler that already exists, so the palette stays a thin
  // layer over the terminal instead of a second source of truth. Plain object (not memoised) keeps the
  // closures fresh; building ~60 entries per render is not worth a stale-closure risk.
  const paletteActions = {
    selectSymbol: handleSelectSymbol,
    setTimeframe: handleTimeframeChange,
    setChartMode: (mode: 'footprint' | 'candles') => setChartMode(mode),
    togglePanel: (panel: PanelId) => setActivePanel((prev) => (prev === panel ? null : panel)),
    toggleOverlay,
    setAutoFollow: (on: boolean) => setViewport((prev) => ({ ...prev, autoFollow: on })),
    fitView: handleFitView,
    openDiagnostics: () => setShowSystemStatus(true),
    openPrimer: () => setShowOnboardingModal(true),
    signOut: currentUser ? () => void handleLogout() : undefined,
  };

  // The server requires authentication and this browser has no (valid) token yet.
  if (authConfig?.authRequired && !hasStoredToken()) {
    return (
      <AuthPanel
        authRequired
        devMode={authConfig.devMode}
        registrationEnabled={authConfig.registrationEnabled}
        billingConfigured={authConfig.billingConfigured}
        plans={authConfig.plans}
        onAuthenticate={handleAuthenticate}
        onRegister={handleRegister}
        onStartCheckout={handleStartCheckout}
        initialError={authNotice}
      />
    );
  }

  // The analytics dock renders on either side of the chart; the divider inside it always faces the chart.
  const dockElement = activePanel ? (
    <React.Suspense fallback={<PanelSkeleton className="analytics-dock" />}>
      <WorkspaceDock
        activePanel={activePanel}
        onClose={() => setActivePanel(null)}
        onSelectPanel={(panel: PanelId) => setActivePanel(panel)}
        side={dockSide}
        onToggleSide={() => setDockSide((prev) => (prev === 'right' ? 'left' : 'right'))}
        symbol={symbol}
        currentPrice={currentPrice}
        instrument={instrument}
        orderbook={orderbook}
        volumeProfile={volumeProfile}
        tpoProfile={tpoProfile}
        tape={tape}
        recentTicks={recentTicks}
        deepTrades={deepTrades}
        deepTradeThresholdUsd={deepTradeThresholdUsd}
        gexProfile={gexProfile}
        optionsFlow={optionsFlow}
      />
    </React.Suspense>
  ) : null;

  return (
    <div className="terminal-shell">
      {authNotice && (
        <div className="flex items-center justify-between gap-3 bg-[#3B1D1D] border-b border-[#7F1D1D] px-4 py-2 text-xs text-[#FCA5A5]">
          <span>{authNotice}</span>
          <button className="underline" onClick={() => setAuthNotice(null)}>
            Dismiss
          </button>
        </div>
      )}

      {/* Accessible status: symbol, feed and replay state announced to screen readers */}
      <span className="sr-only" role="status" aria-live="polite">
        {liveAnnouncement}
      </span>
      {/* 1. Command Station Header (user/plan chip + sign out live in the header now) */}
      <TerminalHeader
        symbol={symbol}
        instrument={instrument}
        currentPrice={currentPrice}
        isConnected={isConnected}
        feedStatus={feedStatus}
        sessionMode={sessionMode}
        onSelectSymbol={handleSelectSymbol}
        showSystemStatus={showSystemStatus}
        onOpenSystemStatus={() => setShowSystemStatus(true)}
        showReplay={showReplay}
        onToggleReplay={() => setShowReplay(!showReplay)}
        showHelp={showHelp}
        onToggleHelp={() => setShowHelp(!showHelp)}
        activePanel={activePanel}
        onTogglePanel={() => setActivePanel(activePanel ? null : 'DOM')}
        highPrice={sessionStats.high}
        lowPrice={sessionStats.low}
        instrumentsList={instrumentsList}
        onOpenPalette={() => setPaletteOpen(true)}
        username={currentUser?.username ?? null}
        planName={sessionPlan?.name ?? null}
        role={currentUser?.role ?? null}
        onSignOut={currentUser ? () => void handleLogout() : undefined}
        viewMode={viewMode}
        onToggleViewMode={handleToggleViewMode}
      />

      {/* 2. Chart Workspace Secondary Toolbar (visible only in chart mode) */}
      {viewMode === 'chart' && (
        <ChartToolbar
          chartMode={chartMode}
          onChartModeChange={setChartMode}
          timeframe={timeframe}
          onTimeframeChange={handleTimeframeChange}
          clusterMultiplier={clusterMultiplier}
          onClusterChange={(c) => setClusterMultiplier(c)}
          showVWAP={showVWAP}
          onToggleVWAP={() => setShowVWAP(!showVWAP)}
          showImbalances={showImbalances}
          onToggleImbalances={() => setShowImbalances(!showImbalances)}
          showDeltaNumbers={showDeltaNumbers}
          onToggleDeltaNumbers={() => setShowDeltaNumbers(!showDeltaNumbers)}
          showCVD={showCVD}
          onToggleCVD={() => setShowCVD(!showCVD)}
          signalFilters={signalFilters}
          onToggleSignalFilter={handleToggleSignalFilter}
          autoFollow={viewport.autoFollow ?? true}
          onToggleAutoFollow={handleToggleAutoFollow}
          onFitView={handleFitView}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          activePanel={activePanel}
          onSelectPanel={(p) => setActivePanel(activePanel === p ? null : p)}
        />
      )}

      {showHelp && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-[#10151C] border-b border-[#1C2630] text-[11px] text-[#22D3EE] font-mono">
          <span>
            💡 <strong>Controls:</strong> Drag to pan · Scroll to zoom bars · Shift+Scroll to zoom price ·
            Double-click to reset · <strong>Ctrl+K</strong> opens the command palette (instrument, timeframe, panel, overlays).
          </span>
          <div className="flex items-center gap-2">
            <button
              className="terminal-btn text-[#F5B942] h-6 px-2"
              onClick={() => setShowOnboardingModal(true)}
              title="Open Order Flow Primer Guide"
            >
              <BookOpen size={12} />
              <span>Primer Guide</span>
            </button>
            <button
              className="terminal-btn terminal-btn-icon h-6 w-6 text-[#7F8B97] hover:text-[#E7EDF3]"
              aria-label="Close help"
              onClick={() => setShowHelp(false)}
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Main Workspace Layout */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left tool rail: TradingView-style vertical toolbar (only actions that really exist) */}
        <ToolRail
          autoFollow={viewport.autoFollow}
          onToggleAutoFollow={handleToggleAutoFollow}
          onFitView={handleFitView}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onOpenPalette={() => setPaletteOpen(true)}
          watchlistOpen={showWatchlist}
          onToggleWatchlist={() => setShowWatchlist((prev) => !prev)}
          dockSide={dockSide}
          onToggleDockSide={() => setDockSide((prev) => (prev === 'right' ? 'left' : 'right'))}
          replayOpen={showReplay}
          onToggleReplay={() => setShowReplay((prev) => !prev)}
          onOpenDiagnostics={() => setShowSystemStatus(true)}
          onScreenshot={handleScreenshot}
          onToggleFullscreen={handleToggleFullscreen}
          isFullscreen={isFullscreen}
          viewMode={viewMode}
          onToggleCockpit={handleToggleViewMode}
        />

        {/* Dock when docked left: same component, divider on its right edge */}
        {dockSide === 'left' && dockElement}

        {/* Center: Footprint Chart Canvas & CVD Panel OR Cockpit Dashboard */}
        {viewMode === 'cockpit' ? (
          <React.Suspense fallback={<div className="flex-1 dc-skeleton opacity-40 m-3 rounded-lg" />}>
            <CockpitDashboard
              symbol={symbol}
              instrument={instrument}
              currentPrice={currentPrice}
              orderbook={orderbook}
              tape={tape}
              recentTicks={recentTicks}
              deepTrades={deepTrades}
              gexProfile={gexProfile}
              isConnected={isConnected}
              onSelectSymbol={handleSelectSymbol}
              onReturnToChart={() => setViewMode('chart')}
              highPrice={sessionStats.high}
              lowPrice={sessionStats.low}
            />
          </React.Suspense>
        ) : (
          <div className="flex-1 flex flex-col min-w-0 h-full">
            <div className="flex-1 min-h-0 relative" id="chart-surface">
              {(bars.length > 0 || historyBars.length > 0) && (
                <FootprintCanvas
                  bars={bars}
                  historyBars={historyBars}
                  isLive={sessionMode === 'LIVE' && feedStatus === 'LIVE'}
                  sessionMode={sessionMode}
                  currentPrice={
                    sessionMode === 'LIVE'
                      ? currentPrice
                      : bars[bars.length - 1]?.close ?? historyBars[historyBars.length - 1]?.close ?? currentPrice
                  }
                  vwapPoints={vwapPoints}
                  deepTrades={deepTrades}
                  absorptions={absorptions}
                  gexProfile={gexProfile}
                  showVWAP={showVWAP}
                  showImbalances={showImbalances}
                  showDeltaNumbers={showDeltaNumbers}
                  signalFilters={signalFilters}
                  tickSize={instrument?.tickSize || 0.25}
                  clusterMultiplier={clusterMultiplier}
                  symbol={symbol}
                  timeframe={timeframe}
                  chartMode={chartMode}
                  viewport={viewport}
                  onViewportChange={setViewport}
                  crosshairX={crosshairX}
                  onCrosshairChange={setCrosshairX}
                />
              )}

              {/* TradingView-style legend: symbol · timeframe · OHLC of the last bar · indicator chips */}
              <ChartLegend
                symbol={symbol}
                timeframe={timeframe}
                chartMode={chartMode}
                exchange={instrument?.exchange}
                lastBar={lastRenderedBar}
                previousClose={previousBarClose}
                feedStatus={feedStatus}
                overlays={{ vwap: showVWAP, imbalances: showImbalances, delta: showDeltaNumbers, cvd: showCVD }}
                onToggleOverlay={toggleOverlay}
                decimals={decimalsForTick(instrument?.tickSize)}
              />

              {bars.length === 0 && historyBars.length === 0 && (
                <div className="chart-empty-state" role="status">
                  <div className="empty-state-box">
                    <div className="font-mono text-[11px] text-[#22D3EE] font-semibold tracking-wide uppercase">
                      {symbol} · {timeframe} · {chartMode}
                    </div>
                    <h2>
                      {sessionMode !== 'LIVE'
                        ? 'No replay records'
                        : isLoadingHistory
                          ? 'Loading market history…'
                          : feedStatus === 'LIVE'
                            ? 'Waiting for the first validated tick'
                            : 'Feed unavailable for this instrument'}
                    </h2>
                    <p>
                      {feedStatus === 'LIVE'
                        ? `Connected and subscribed. The chart draws only validated ${symbol} trades — nothing is simulated, so an empty tape stays empty.`
                        : isConnected
                          ? 'The server has no validated real-time source for this instrument. Check the provider configuration and your vendor entitlement, then open Diagnostics for the exact reason.'
                          : 'Reconnecting to the engine… if this persists, open Diagnostics to inspect the session.'}
                    </p>
                    <div className="empty-state-actions">
                      <button className="terminal-btn" onClick={() => setShowSystemStatus(true)}>
                        <Activity size={13} /> Open diagnostics
                      </button>
                      <button className="terminal-btn" onClick={() => setShowOnboardingModal(true)}>
                        <BookOpen size={13} /> How to read this chart
                      </button>
                      <button className="terminal-btn" onClick={() => setPaletteOpen(true)}>
                        <Search size={13} /> Switch instrument (Ctrl+K)
                      </button>
                    </div>
                    <div className="flex justify-between items-center pt-3 mt-4 border-t border-[#1C2630] text-[10px] text-[#7F8B97] font-mono">
                      <span>
                        Engine:{' '}
                        <strong style={{ color: isConnected ? 'var(--ok)' : 'var(--danger)' }}>
                          {isConnected ? 'Connected' : 'Offline'}
                        </strong>
                      </span>
                      <span>
                        Provider: <strong className="text-[#E7EDF3]">{instrument?.exchange ? 'Licensed vendor' : 'CME'}</strong>
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Sub-panel: CVD Panel */}
            {showCVD && (bars.length > 0 || historyBars.length > 0) && (
              <CVDPanel
                bars={bars}
                historyBars={historyBars}
                currentCVD={currentCVD}
                viewport={viewport}
                crosshairX={crosshairX}
                onViewportChange={setViewport}
                onCrosshairChange={setCrosshairX}
                height={cvdHeight}
                onHeightChange={setCvdHeight}
                onClose={() => setShowCVD(false)}
              />
            )}
          </div>
        )}

        {/* Dock on the right (the left position renders before the chart) */}
        {dockSide === 'right' && dockElement}

        {/* Watchlist panel (TradingView-style right-hand list; honest feed states, no fake prices) */}
        {showWatchlist && (
          <MarketWatch
            instruments={instrumentsList}
            currentSymbol={symbol}
            currentPrice={currentPrice}
            decimals={decimalsForTick(instrument?.tickSize)}
            onSelectSymbol={handleSelectSymbol}
            onClose={() => setShowWatchlist(false)}
          />
        )}
      </div>

      {/* Session Replay Bar (lazy) */}
      {showReplay && (
        <React.Suspense fallback={<PanelSkeleton className="h-[74px] border-t border-[#1C2630]" />}>
          <TickReplayWidget
            progress={replayProgress}
            replayFrame={replayFrame}
            symbol={symbol}
            feedStatus={feedStatus}
            historySource={historySource}
            gexSource={gexProfile?.dataSource}
          />
        </React.Suspense>
      )}

      {/* Terminal Status Bar */}
      <TerminalStatusBar
        feedStatus={feedStatus}
        isConnected={isConnected}
        historySource={historySource}
        isLoadingHistory={isLoadingHistory}
        hasMoreHistory={hasMoreHistory}
        sessionMode={sessionMode}
        tickCount={tickCount}
        latencyMs={isConnected ? latencyMs : null}
      />

      {/* Command Palette (Ctrl+K): instrument, timeframe, panel and overlay switching in one place */}
      <CommandPalette
        key={paletteOpen ? 'palette-open' : 'palette-closed'}
        isOpen={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        instruments={instrumentsList}
        currentSymbol={symbol}
        timeframe={timeframe}
        chartMode={chartMode}
        activePanel={activePanel}
        overlays={{ vwap: showVWAP, imbalances: showImbalances, delta: showDeltaNumbers, cvd: showCVD }}
        autoFollow={viewport.autoFollow}
        actions={paletteActions}
      />

      {/* System Status Diagnostics Modal (lazy: only loads when actually opened) */}
      {showSystemStatus && (
        <React.Suspense fallback={null}>
          <SystemStatusModal isOpen onClose={() => setShowSystemStatus(false)} activeSymbol={symbol} />
        </React.Suspense>
      )}

      {/* Onboarding Primer Guide Modal (lazy, stays mounted for first-run guidance) */}
      <React.Suspense fallback={null}>
        <OnboardingCard
          symbol={symbol}
          forceVisible={showOnboardingModal}
          onClose={() => setShowOnboardingModal(false)}
        />
      </React.Suspense>
    </div>
  );
};

export default App;

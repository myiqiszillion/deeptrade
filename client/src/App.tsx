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
import { TickReplayWidget } from './components/Backtest/TickReplayWidget';
import { deepchartApi } from './services/api';
import { SystemStatusModal } from './components/Status/SystemStatusModal';
import { OnboardingCard } from './components/Help/OnboardingCard';
import { TerminalHeader } from './components/Navigation/TerminalHeader';
import { ChartToolbar, SignalFilters } from './components/Navigation/ChartToolbar';
import { WorkspaceDock } from './components/Navigation/WorkspaceDock';
import { TerminalStatusBar } from './components/Status/TerminalStatusBar';
import { X, BookOpen } from 'lucide-react';

const POPULAR_FUTURES = [
  { symbol: 'ES', name: 'E-mini S&P 500 (CME Globex)' },
  { symbol: 'NQ', name: 'E-mini Nasdaq 100 (CME Globex)' },
  { symbol: 'MES', name: 'Micro E-mini S&P 500 (CME)' },
  { symbol: 'MNQ', name: 'Micro E-mini Nasdaq 100 (CME)' },
  { symbol: 'YM', name: 'E-mini Dow Jones (CBOT)' },
  { symbol: 'MYM', name: 'Micro E-mini Dow Jones (CBOT)' },
  { symbol: 'RTY', name: 'E-mini Russell 2000 (CME)' },
  { symbol: 'M2K', name: 'Micro Russell 2000 (CME)' },
  { symbol: 'GC', name: 'Gold Futures (COMEX)' },
  { symbol: 'MGC', name: 'Micro Gold Futures (COMEX)' },
  { symbol: 'CL', name: 'Crude Oil (NYMEX)' },
  { symbol: 'MCL', name: 'Micro Crude Oil (NYMEX)' },
  { symbol: 'NG', name: 'Natural Gas (NYMEX)' },
];

const SETTINGS_STORAGE_KEY = 'deepchart_free_settings_v1';

interface SavedSettings {
  activePanel?: 'DOM' | 'Profile' | 'Tape' | 'GEX' | 'Flow' | null;
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
  const [cvdHeight, setCvdHeight] = useState<number>(85);

  // Core Data State
  const [bars, setBars] = useState<FootprintBar[]>([]);
  const [orderbook, setOrderbook] = useState<OrderbookSnapshot>({
    bids: [],
    asks: [],
    timestamp: 0,
    lastUpdateId: 0,
  });
  const [volumeProfile, setVolumeProfile] = useState<VolumeProfileData>({
    poc: 5850,
    vah: 5860,
    val: 5840,
    totalVolume: 0,
    levels: [],
  });
  const [tpoProfile, setTpoProfile] = useState<TPOProfileData>({
    poc: 5850,
    vah: 5860,
    val: 5840,
    initialBalance: { high: 5860, low: 5840 },
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

  // Features & Panels Toggles (restored from browser storage)
  const [activePanel, setActivePanel] = useState<SavedSettings['activePanel']>(
    savedSettings.activePanel === null ? null :
      ['DOM', 'Profile', 'Tape', 'GEX', 'Flow'].includes(savedSettings.activePanel ?? '') ? savedSettings.activePanel : 'DOM'
  );
  const [instrumentsList, setInstrumentsList] = useState(POPULAR_FUTURES);
  const [showSystemStatus, setShowSystemStatus] = useState(false);
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showReplay, setShowReplay] = useState(false);
  const [showCVD, setShowCVD] = useState(true);
  const [showVWAP, setShowVWAP] = useState(savedSettings.showVWAP ?? true);
  const [showImbalances, setShowImbalances] = useState(savedSettings.showImbalances ?? true);
  const [showDeltaNumbers, setShowDeltaNumbers] = useState(savedSettings.showDeltaNumbers ?? true);
  const [clusterMultiplier, setClusterMultiplier] = useState<'auto' | 1 | 2 | 4 | 5 | 10 | 25 | 50>(
    savedSettings.clusterMultiplier ?? 'auto'
  );
  const [timeframe, setTimeframe] = useState(savedSettings.timeframe || '1m');
  const [signalFilters, setSignalFilters] = useState<SignalFilters>({
    buyAbs: true,
    sellAbs: true,
    gamma: true,
    whale: true,
  });
  const [tickCount, setTickCount] = useState<number>(1248321);

  // Load dynamic instrument capabilities from server
  useEffect(() => {
    deepchartApi.getInstruments().then((list) => {
      if (list && list.length > 0) {
        setInstrumentsList(
          list.map((i) => ({
            symbol: i.symbol,
            name: `${i.name} (${i.isLive ? 'Live' : i.exchange})`,
          }))
        );
      }
    }).catch(() => {});
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
  ]);

  // Connect WebSocket & Register Listeners
  useEffect(() => {
    wsClient.setListeners({
      onConnectionChange: (connected) => {
        setIsConnected(connected);
        if (!connected) setFeedStatus('UNAVAILABLE');
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
        setHistoryBars(data.historyBars ?? []);
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
      onHistoryResponse: (resp) => {
        isLoadingHistoryRef.current = false;
        setIsLoadingHistory(false);
        if (resp.symbol !== symbolRef.current || resp.timeframe !== timeframeRef.current) {
          return; // Ignore stale response from earlier symbol/timeframe
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
          setHistoryBars((prev) => {
            const seenTimes = new Set<number>(prev.map((b) => b.time));
            const newBars = resp.bars.filter((b) => !seenTimes.has(b.time));
            const merged = [...newBars, ...prev].sort((a, b) => a.time - b.time);
            return merged.length > MAX_CLIENT_BARS ? merged.slice(-MAX_CLIENT_BARS) : merged;
          });
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
    desiredSymbolRef.current = sym;
    symbolRef.current = sym;
    pendingTicksRef.current = [];
    oldestBarTimeRef.current = null;
    hasMoreHistoryRef.current = true;
    isLoadingHistoryRef.current = false;
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
      let oldestTime: number | undefined;
      if (historyBars.length > 0) {
        oldestTime = historyBars[0].time;
      } else if (bars.length > 0) {
        oldestTime = bars[0].time;
      }
      if (oldestTime && (!oldestBarTimeRef.current || oldestTime < oldestBarTimeRef.current)) {
        oldestBarTimeRef.current = oldestTime;
        isLoadingHistoryRef.current = true;
        setIsLoadingHistory(true);
        wsClient.fetchHistory(symbolRef.current, timeframeRef.current, oldestTime, 300);
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

  return (
    <div className="terminal-shell">
      {/* 1. Command Station Header */}
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
      />

      {/* 2. Chart Workspace Secondary Toolbar */}
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

      {showHelp && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-[#10151C] border-b border-[#1C2630] text-[11px] text-[#22D3EE] font-mono">
          <span>
            💡 <strong>Microstructure Controls:</strong> Drag to Pan • Scroll to Zoom Bars • Shift+Scroll to Zoom Price Scale • Double-Click to Reset View.
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
        {/* Center: Footprint Chart Canvas & CVD Panel */}
        <div className="flex-1 flex flex-col min-w-0 h-full">
          <div className="flex-1 min-h-0 relative">
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

            {bars.length === 0 && historyBars.length === 0 && (
              <div className="chart-empty-state" role="status">
                <div className="empty-state-box">
                  <div className="font-mono text-xs text-[#22D3EE] font-semibold tracking-wide uppercase">
                    {symbol} · {timeframe} · {chartMode}
                  </div>
                  <h2>{sessionMode !== 'LIVE' ? 'No Replay Records' : isLoadingHistory ? 'Loading Market History…' : 'Waiting for Market Data'}</h2>
                  <p>
                    {isConnected
                      ? `Awaiting validated real-time trade records for ${symbol}.`
                      : 'Data feed is offline. Connecting to engine…'}
                  </p>
                  <div className="flex justify-between items-center pt-2 border-t border-[#1C2630] text-[10px] text-[#7F8B97] font-mono">
                    <span>Engine: <strong className={isConnected ? 'text-[#19C37D]' : 'text-[#F05252]'}>{isConnected ? 'Connected' : 'Offline'}</strong></span>
                    <span>Provider: <strong className="text-[#E7EDF3]">Databento / CME</strong></span>
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

        {/* Right Dock: DOM, Profile, Tape, GEX, Flow */}
        <WorkspaceDock
          activePanel={activePanel}
          onClose={() => setActivePanel(null)}
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
      </div>

      {/* Session Replay Bar */}
      {showReplay && (
        <TickReplayWidget
          progress={replayProgress}
          symbol={symbol}
          feedStatus={feedStatus}
          historySource={historySource}
          gexSource={gexProfile?.dataSource}
        />
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
        latencyMs={isConnected ? 24 : 0}
      />

      {/* System Status Diagnostics Modal */}
      <SystemStatusModal
        isOpen={showSystemStatus}
        onClose={() => setShowSystemStatus(false)}
        activeSymbol={symbol}
      />

      {/* Onboarding Primer Guide Modal */}
      <OnboardingCard
        symbol={symbol}
        forceVisible={showOnboardingModal}
        onClose={() => setShowOnboardingModal(false)}
      />
    </div>
  );
};

export default App;

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
import { DOMScalper } from './components/DOM/DOMScalper';
import { ProfileOverlay } from './components/Profile/ProfileOverlay';
import { SpeedOfTapeWidget } from './components/Tape/SpeedOfTapeWidget';
import { TickReplayWidget } from './components/Backtest/TickReplayWidget';
import { GEXPanel } from './components/Options/GEXPanel';
import { OptionsFlowWidget } from './components/Options/OptionsFlowWidget';
import { formatPrice } from './services/priceFormat';
import { RotateCcw, X, PanelRight, HelpCircle } from 'lucide-react';

const POPULAR_FUTURES = [
  { symbol: 'ES', name: 'E-mini S&P 500' },
  { symbol: 'MES', name: 'Micro E-mini S&P 500' },
  { symbol: 'NQ', name: 'E-mini Nasdaq 100' },
  { symbol: 'MNQ', name: 'Micro E-mini Nasdaq 100' },
  { symbol: 'YM', name: 'E-mini Dow Jones' },
  { symbol: 'RTY', name: 'E-mini Russell 2000' },
  { symbol: 'GC', name: 'Gold Futures' },
  { symbol: 'CL', name: 'Crude Oil' },
  { symbol: 'NG', name: 'Natural Gas' },
  { symbol: 'BTCUSDT', name: 'Bitcoin Perpetual' },
];

const SETTINGS_STORAGE_KEY = 'deepchart_free_settings_v1';

interface SavedSettings {
  activePanel?: 'DOM' | 'Profile' | 'Tape' | 'GEX' | 'Flow' | null;
  symbol?: string;
  timeframe?: string;
  chartMode?: 'footprint' | 'candles';
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
  const [symbol, setSymbol] = useState(savedSettings.symbol || 'BTCUSDT');
  const [instrument, setInstrument] = useState<FuturesInstrument | undefined>();
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [chartMode, setChartMode] = useState<'footprint' | 'candles'>(savedSettings.chartMode || 'footprint');

  // Synchronized Viewport & Crosshair across Chart & CVD
  const [viewport, setViewport] = useState<ChartViewport>({
    panX: 0,
    panY: 300,
    barWidth: 80,
    barSpacing: 20,
    priceScale: 6,
    autoFollow: true,
  });
  const [crosshairX, setCrosshairX] = useState<number | null>(null);

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
  const symbolRef = useRef(savedSettings.symbol || 'BTCUSDT');
  const desiredSymbolRef = useRef(savedSettings.symbol || 'BTCUSDT');
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
  const [showHelp, setShowHelp] = useState(false);
  const [showReplay, setShowReplay] = useState(false);
  const [showVWAP, setShowVWAP] = useState(savedSettings.showVWAP ?? true);
  const [showImbalances, setShowImbalances] = useState(savedSettings.showImbalances ?? true);
  const [showDeltaNumbers, setShowDeltaNumbers] = useState(savedSettings.showDeltaNumbers ?? true);
  const [timeframe, setTimeframe] = useState(savedSettings.timeframe || '1m');

  // Persist user preferences to localStorage
  useEffect(() => {
    saveSettings({
      symbol,
      timeframe,
      chartMode,
      activePanel,
      showVWAP,
      showImbalances,
      showDeltaNumbers,
    });
  }, [
    symbol,
    timeframe,
    chartMode,
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
            desiredSymbolRef.current === 'BTCUSDT' ? 'binance' : 'cme',
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
      if (lastPriceRef.current !== null) setCurrentPrice(lastPriceRef.current);
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
    const src = sym === 'BTCUSDT' ? 'binance' : 'cme';
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
    const src = desiredSymbolRef.current === 'BTCUSDT' ? 'binance' : 'cme';
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

  return (
    <div className="terminal-shell">
      <header className="terminal-header">
        <div className="terminal-brand"><span className="brand-mark">D</span><span>Deep<span className="text-slate-400">Chart</span></span></div>
        <select aria-label="Instrument" value={symbol} onChange={(e) => handleSelectSymbol(e.target.value)} className="terminal-select instrument-select">
          {POPULAR_FUTURES.map((f) => <option key={f.symbol} value={f.symbol}>{f.symbol} · {f.name}</option>)}
        </select>
        <span className="font-mono text-sm tabular-nums text-slate-100">{currentPrice > 0 ? formatPrice(currentPrice, instrument?.tickSize) : '—'}</span>
        <span className="hidden xl:inline text-[11px] text-slate-500">{instrument?.exchange ?? 'Market data'}</span>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <span className={isConnected ? 'connection-dot connected' : 'connection-dot'} title={isConnected ? 'Engine connected — not a market-feed guarantee' : 'Engine disconnected'} />
          <span className="hidden sm:inline text-[11px] text-slate-400">{isConnected ? 'Connected' : 'Disconnected'}</span>
          <button className="terminal-button" aria-pressed={showReplay} onClick={() => setShowReplay(!showReplay)}>Replay</button>
          <button className="terminal-icon" aria-label="Chart help" aria-expanded={showHelp} onClick={() => setShowHelp(!showHelp)}><HelpCircle size={15} /></button>
          <button className="terminal-icon" aria-label="Toggle analytics panel" aria-expanded={!!activePanel} onClick={() => setActivePanel(activePanel ? null : 'DOM')}><PanelRight size={15} /></button>
        </div>
      </header>
      <nav className="chart-toolbar" aria-label="Chart controls">
        <div className="segmented-control">
          {(['footprint', 'candles'] as const).map((mode) => <button key={mode} aria-pressed={chartMode === mode} onClick={() => setChartMode(mode)}>{mode === 'footprint' ? 'Footprint' : 'Candles'}</button>)}
        </div>
        <select aria-label="Timeframe" value={timeframe} onChange={(e) => handleTimeframeChange(e.target.value)} className="terminal-select">
          {['1s', '5s', '15s', '1m', '5m'].map((tf) => <option key={tf}>{tf}</option>)}
        </select>
        <span className="toolbar-divider" />
        <button className="terminal-button" aria-pressed={showImbalances} onClick={() => setShowImbalances(!showImbalances)}>Imbalance</button>
        <button className="terminal-button" aria-pressed={showVWAP} onClick={() => setShowVWAP(!showVWAP)}>VWAP</button>
        <button className="terminal-button" aria-pressed={showDeltaNumbers} onClick={() => setShowDeltaNumbers(!showDeltaNumbers)}>Delta</button>
        <button className="terminal-icon" title="Reset chart view" aria-label="Reset chart view" onClick={() => setViewport((prev) => ({ ...prev, panX: 0, panY: 300, barWidth: 80, priceScale: 6, autoFollow: true, anchorPrice: undefined }))}><RotateCcw size={14} /></button>
        <div className="ml-auto flex gap-1">
          {(['DOM', 'Profile', 'Tape', 'GEX', 'Flow'] as const).map((panel) => <button key={panel} className="terminal-button" aria-pressed={activePanel === panel} onClick={() => setActivePanel(activePanel === panel ? null : panel)}>{panel}</button>)}
        </div>
      </nav>
      {showHelp && <div className="help-strip"><span>Drag to pan ? Scroll to zoom ? Fit view to reset ? Analytics tabs open one panel at a time. Historical candles do not contain footprint data.</span><button className="terminal-icon" aria-label="Close help" onClick={() => setShowHelp(false)}><X size={14} /></button></div>}
      {/* Main Content Workspace */}
      <div className="workspace flex-1 min-h-0 flex overflow-hidden">
        {/* Center: Main Footprint Canvas & CVD Panel */}
        <div className="flex-1 flex flex-col min-w-0 h-full">
          <div className="flex-1 min-h-0 relative">
            <FootprintCanvas
              bars={bars}
              historyBars={historyBars}
              isLive={sessionMode === 'LIVE'}
              sessionMode={sessionMode}
              currentPrice={sessionMode === 'LIVE' ? currentPrice :
                (bars[bars.length - 1]?.close ?? historyBars[historyBars.length - 1]?.close ?? currentPrice)}
              vwapPoints={vwapPoints}
              deepTrades={deepTrades}
              absorptions={absorptions}
              gexProfile={gexProfile}
              showVWAP={showVWAP}
              showImbalances={showImbalances}
              showDeltaNumbers={showDeltaNumbers}
              tickSize={instrument?.tickSize || 0.25}
              symbol={symbol}
              timeframe={timeframe}
              chartMode={chartMode}
              viewport={viewport}
              onViewportChange={setViewport}
              crosshairX={crosshairX}
              onCrosshairChange={setCrosshairX}
            />
            {bars.length === 0 && historyBars.length === 0 && <div className="chart-empty-state"><div className="empty-state-card"><span className="empty-state-eyebrow">{symbol} / {timeframe}</span><h2>Waiting for market data</h2><p>{isConnected ? 'No validated market records are available for this instrument.' : 'Connecting to the chart engine.'}</p><span className="text-[11px] text-slate-500">{symbol === 'BTCUSDT' ? 'Binance public market data is unavailable.' : 'Databento CME access, contract permissions, or market-data configuration is unavailable.'} No simulated data is displayed.</span></div></div>}
          </div>

          <CVDPanel
            bars={bars}
            currentCVD={currentCVD}
            viewport={viewport}
            crosshairX={crosshairX}
            onViewportChange={setViewport}
            onCrosshairChange={setCrosshairX}
          />
        </div>

        {/* Right Side Dock: horizontally scrollable so multiple analytics panels never crush the chart. */}
        <aside className={activePanel ? "analytics-dock" : "hidden"} aria-label="Analytics"><div className="dock-title"><span>{activePanel} <span className="text-slate-500 font-normal">/ {symbol}</span></span><button className="terminal-icon" aria-label="Close analytics panel" onClick={() => setActivePanel(null)}><X size={14} /></button></div><div className="dock-content">
          {activePanel === 'GEX' && <GEXPanel profile={gexProfile} currentPrice={currentPrice} />}

          {activePanel === 'Flow' && <OptionsFlowWidget flowTrades={optionsFlow} />}

          {activePanel === 'Profile' && (
            <ProfileOverlay
              volumeProfile={volumeProfile}
              tpoProfile={tpoProfile}
              currentPrice={currentPrice}
              tickSize={instrument?.tickSize}
            />
          )}

          {activePanel === 'DOM' && (
            <DOMScalper
              orderbook={orderbook}
              currentPrice={currentPrice}
              symbol={symbol}
              isFutures={symbol !== 'BTCUSDT'}
              tickSize={instrument?.tickSize}
            />
          )}

          {activePanel === 'Tape' && (
            <SpeedOfTapeWidget
              tape={tape}
              recentTicks={recentTicks}
              deepTrades={deepTrades}
              symbol={symbol}
              deepTradeThresholdUsd={deepTradeThresholdUsd}
              tickSize={instrument?.tickSize}
            />
          )}
        </div></aside>
      </div>

      {/* Bottom Footer: Backtest Every Tick + data provenance */}
      {showReplay && <TickReplayWidget
        progress={replayProgress}
        symbol={symbol}
        isCrypto={symbol === 'BTCUSDT'}
        feedStatus={feedStatus}
        historySource={historySource}
        gexSource={gexProfile?.dataSource}
      />}

      <footer className="terminal-status">
        <span className={feedStatus === 'LIVE' && isConnected ? 'text-emerald-400' : 'text-amber-400'}>● {feedStatus === 'LIVE' && isConnected ? 'Feed realtime' : 'Feed unavailable'}</span>
        <span>History: {historySource === 'REAL_TICKS' ? 'real ticks' : historySource === 'REAL_BARS' ? 'real bars' : 'none'}</span>
        {isLoadingHistory && <span className="text-sky-400">Loading history…</span>}
        {!hasMoreHistory && <span>History limit reached</span>}
        <span className="ml-auto">{sessionMode === 'LIVE' ? 'Chart workspace' : sessionMode.replaceAll('_', ' ')}</span>
      </footer>
    </div>
  );
};

export default App;

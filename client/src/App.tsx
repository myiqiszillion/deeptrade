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
import { OnboardingCard } from './components/Help/OnboardingCard';
import { GEXPanel } from './components/Options/GEXPanel';
import { OptionsFlowWidget } from './components/Options/OptionsFlowWidget';
import { formatPrice } from './services/priceFormat';
import {
  Activity,
  Layers,
  BarChart2,
  Wifi,
  WifiOff,
  Shield,
  Flame,
} from 'lucide-react';

const POPULAR_FUTURES = [
  { symbol: 'ES', name: 'E-mini S&P 500' },
  { symbol: 'NQ', name: 'E-mini Nasdaq 100' },
  { symbol: 'YM', name: 'E-mini Dow Jones' },
  { symbol: 'RTY', name: 'E-mini Russell 2000' },
  { symbol: 'GC', name: 'Gold Futures' },
  { symbol: 'CL', name: 'Crude Oil' },
  { symbol: 'NG', name: 'Natural Gas' },
  { symbol: 'BTCUSDT', name: 'Bitcoin Perpetual' },
];

const SETTINGS_STORAGE_KEY = 'deepchart_free_settings_v1';

interface SavedSettings {
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

/** Insert or replace a footprint bar, keeping the series ordered by bar open time. */
function mergeBar(bars: FootprintBar[], bar: FootprintBar): FootprintBar[] {
  const next = bars.some((b) => b.id === bar.id) ? bars.map((b) => (b.id === bar.id ? bar : b)) : [...bars, bar];
  return next.sort((a, b) => a.time - b.time);
}

export const App: React.FC = () => {
  const [savedSettings] = useState<SavedSettings>(loadSavedSettings);

  const [isConnected, setIsConnected] = useState(false);
  const [symbol, setSymbol] = useState(savedSettings.symbol || 'BTCUSDT');
  const [instrument, setInstrument] = useState<FuturesInstrument | undefined>();
  const [currentPrice, setCurrentPrice] = useState<number>(65000.0);
  const [chartMode, setChartMode] = useState<'footprint' | 'candles'>(savedSettings.chartMode || 'footprint');

  // Synchronized Viewport & Crosshair across Chart & CVD
  const [viewport, setViewport] = useState<ChartViewport>({
    panX: 0,
    panY: 300,
    barWidth: 80,
    barSpacing: 20,
    priceScale: 6,
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

  // Features & Panels Toggles (restored from browser storage)
  const [showDOM, setShowDOM] = useState(savedSettings.showDOM ?? true);
  const [showProfile, setShowProfile] = useState(savedSettings.showProfile ?? true);
  const [showTape, setShowTape] = useState(savedSettings.showTape ?? false);
  const [showGEX, setShowGEX] = useState(savedSettings.showGEX ?? true);
  const [showOptionsFlow, setShowOptionsFlow] = useState(savedSettings.showOptionsFlow ?? false);
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
      showDOM,
      showProfile,
      showTape,
      showGEX,
      showOptionsFlow,
      showVWAP,
      showImbalances,
      showDeltaNumbers,
    });
  }, [
    symbol,
    timeframe,
    chartMode,
    showDOM,
    showProfile,
    showTape,
    showGEX,
    showOptionsFlow,
    showVWAP,
    showImbalances,
    showDeltaNumbers,
  ]);

  // Connect WebSocket & Register Listeners
  useEffect(() => {
    wsClient.setListeners({
      onConnectionChange: (connected) => setIsConnected(connected),
      onInitState: (data) => {
        // After a reconnect the server may be back on its default contract. Ask it to
        // switch instead of silently reverting the UI to another instrument.
        if (data.symbol !== desiredSymbolRef.current) {
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
          pendingTicksRef.current = [];
          setBars([]);
          setRecentTicks([]);
          setDeepTrades([]);
          setAbsorptions([]);
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
        if (data.gexProfile) setGexProfile(data.gexProfile);
        if (data.optionsFlow) setOptionsFlow(data.optionsFlow);
        if (data.orderbook.asks[0]) {
          setCurrentPrice(data.orderbook.asks[0].price);
        }
      },
      onTick: (tick) => {
        pendingTicksRef.current.unshift(tick);
        lastPriceRef.current = tick.price;
      },
      onBarUpdate: (bar) => {
        setBars((prev) => mergeBar(prev, bar));
        setCurrentCVD(bar.cvd);
      },
      onBarClose: (bar) => {
        // A close can arrive for a bar that is no longer the last one, so merge by id and
        // keep the series ordered by open time.
        setBars((prev) => mergeBar(prev, bar));
        setCurrentCVD(bar.cvd);
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
    setSymbol(sym);
    const src = sym === 'BTCUSDT' ? 'binance' : 'cme';
    wsClient.subscribe(sym, src, timeframeRef.current);
  };

  const handleTimeframeChange = (tf: string) => {
    timeframeRef.current = tf;
    setTimeframe(tf);
    const src = desiredSymbolRef.current === 'BTCUSDT' ? 'binance' : 'cme';
    wsClient.subscribe(desiredSymbolRef.current, src, tf);
  };

  return (
    <div className="relative flex flex-col w-screen h-screen bg-brand-bg text-brand-text font-sans overflow-hidden select-none">
      {/* Top Header Bar */}
      <header className="h-12 border-b border-brand-border bg-brand-surface px-4 flex items-center justify-between z-20">
        {/* Left: Brand & Symbol Selector */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-gradient-to-tr from-amber-500 to-rose-500 flex items-center justify-center font-bold text-black text-sm shadow">
              DC
            </div>
            <span className="font-extrabold text-base tracking-wider text-white">
              DEEP<span className="text-amber-400">CHART</span>
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300 font-bold border border-emerald-500/30">
              FREE · ORDER FLOW
            </span>
          </div>

          <div className="h-5 w-px bg-brand-border" />

          {/* Futures Symbol Selector */}
          <div className="flex items-center gap-1 bg-brand-bg p-0.5 rounded border border-brand-border text-xs">
            {POPULAR_FUTURES.map((f) => (
              <button
                key={f.symbol}
                onClick={() => handleSelectSymbol(f.symbol)}
                className={`px-2 py-1 rounded font-mono font-bold transition-all ${
                  symbol === f.symbol
                    ? 'bg-amber-500 text-black shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
                title={f.name}
              >
                {f.symbol}
              </button>
            ))}
          </div>

          {/* Chart Mode Toggle */}
          <div className="flex items-center bg-brand-bg p-0.5 rounded border border-brand-border text-xs">
            <button
              onClick={() => setChartMode('footprint')}
              className={`px-2 py-1 rounded font-semibold transition-all ${
                chartMode === 'footprint'
                  ? 'bg-amber-500 text-black shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Footprint Bid × Ask Clusters"
            >
              Footprint
            </button>
            <button
              onClick={() => setChartMode('candles')}
              className={`px-2 py-1 rounded font-semibold transition-all ${
                chartMode === 'candles'
                  ? 'bg-amber-500 text-black shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Standard Candlesticks with Order Flow Delta"
            >
              Candles
            </button>
          </div>

          {/* Current Price Badge */}
          <span className="px-2.5 py-1 rounded bg-amber-500/15 text-amber-400 font-bold font-mono text-sm border border-amber-500/30">
            {formatPrice(currentPrice, instrument?.tickSize)}
          </span>
        </div>

        {/* Center: Quick Chart Toggles */}
        <div className="flex items-center gap-1 bg-brand-surfaceHover p-1 rounded-lg border border-brand-border text-xs">
          <button
            onClick={() => setShowImbalances(!showImbalances)}
            className={`px-2 py-0.5 rounded font-medium ${
              showImbalances ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' : 'text-slate-400'
            }`}
          >
            Imbalance 300%
          </button>
          <button
            onClick={() => setShowVWAP(!showVWAP)}
            className={`px-2 py-0.5 rounded font-medium ${
              showVWAP ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40' : 'text-slate-400'
            }`}
          >
            VWAP Bands
          </button>
          <button
            onClick={() => setShowDeltaNumbers(!showDeltaNumbers)}
            className={`px-2 py-0.5 rounded font-medium ${
              showDeltaNumbers ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'text-slate-400'
            }`}
          >
            Delta Bar
          </button>

          <div className="h-4 w-px bg-brand-border" />

          {/* Footprint bar timeframe (server rebuilds the bar engine) */}
          <div className="flex items-center gap-1">
            <span className="text-slate-500 text-[10px]">TF</span>
            {['1s', '5s', '15s', '1m', '5m'].map((tf) => (
              <button
                key={tf}
                onClick={() => handleTimeframeChange(tf)}
                className={`px-1.5 py-0.5 rounded font-mono text-[10px] ${
                  timeframe === tf ? 'bg-amber-500 text-black font-bold' : 'text-slate-400 hover:text-white'
                }`}
                title={`Footprint bar duration: ${tf}`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>

        {/* Right: Panels & Tool Toggles */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowGEX(!showGEX)}
            className={`px-2 py-1 rounded flex items-center gap-1 text-xs font-semibold ${
              showGEX ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' : 'text-slate-400 hover:bg-slate-800'
            }`}
            title="Toggle Gamma Exposure (GEX) Panel"
          >
            <Shield size={14} />
            <span>GEX</span>
          </button>

          <button
            onClick={() => setShowOptionsFlow(!showOptionsFlow)}
            className={`px-2 py-1 rounded flex items-center gap-1 text-xs font-semibold ${
              showOptionsFlow ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40' : 'text-slate-400 hover:bg-slate-800'
            }`}
            title="Toggle Options Flow Scanner"
          >
            <Flame size={14} />
            <span>Flow</span>
          </button>

          <button
            onClick={() => setShowDOM(!showDOM)}
            className={`px-2 py-1 rounded flex items-center gap-1 text-xs ${
              showDOM ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-800'
            }`}
            title="Toggle DOM Ladder"
          >
            <Layers size={14} />
            <span>DOM</span>
          </button>

          <button
            onClick={() => setShowProfile(!showProfile)}
            className={`px-2 py-1 rounded flex items-center gap-1 text-xs ${
              showProfile ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-800'
            }`}
            title="Toggle Volume & Market Profile"
          >
            <BarChart2 size={14} />
            <span>Profile</span>
          </button>

          <button
            onClick={() => setShowTape(!showTape)}
            className={`px-2 py-1 rounded flex items-center gap-1 text-xs ${
              showTape ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-800'
            }`}
            title="Toggle Speed of Tape"
          >
            <Activity size={14} />
            <span>Tape</span>
          </button>

          <div className="h-5 w-px bg-brand-border" />

          {/* WS Connection Status */}
          <div className="pl-1">
            {isConnected ? (
              <span className="text-emerald-400" title="Connected to DeepChart Real Engine">
                <Wifi size={14} />
              </span>
            ) : (
              <span className="text-rose-500" title="Disconnected">
                <WifiOff size={14} />
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Workspace */}
      <div className="flex-1 flex overflow-hidden">
        {/* Center: Main Footprint Canvas & CVD Panel */}
        <div className="flex-1 flex flex-col min-w-0 h-full">
          <div className="flex-1 min-h-0 relative">
            <FootprintCanvas
              bars={bars}
              historyBars={historyBars}
              isLive={feedStatus === 'LIVE'}
              currentPrice={feedStatus === 'LIVE' ? currentPrice :
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
              chartMode={chartMode}
              viewport={viewport}
              onViewportChange={setViewport}
              crosshairX={crosshairX}
              onCrosshairChange={setCrosshairX}
            />
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

        {/* Right Side Panels */}
        {showGEX && <GEXPanel profile={gexProfile} currentPrice={currentPrice} />}

        {showOptionsFlow && <OptionsFlowWidget flowTrades={optionsFlow} />}

        {showProfile && (
          <ProfileOverlay
            volumeProfile={volumeProfile}
            tpoProfile={tpoProfile}
            currentPrice={currentPrice}
            tickSize={instrument?.tickSize}
          />
        )}

        {showDOM && (
          <DOMScalper
            orderbook={orderbook}
            currentPrice={currentPrice}
            symbol={symbol}
            isFutures={symbol !== 'BTCUSDT'}
            tickSize={instrument?.tickSize}
          />
        )}

        {showTape && (
          <SpeedOfTapeWidget
            tape={tape}
            recentTicks={recentTicks}
            deepTrades={deepTrades}
            symbol={symbol}
            deepTradeThresholdUsd={deepTradeThresholdUsd}
            tickSize={instrument?.tickSize}
          />
        )}
      </div>

      {/* Bottom Footer: Backtest Every Tick + data provenance */}
      <TickReplayWidget
        progress={replayProgress}
        symbol={symbol}
        isCrypto={symbol === 'BTCUSDT'}
        feedStatus={feedStatus}
        historySource={historySource}
        gexSource={gexProfile?.dataSource}
      />

      {/* Real-only guard: never render fabricated market data for feedless instruments */}
      {feedStatus === 'UNAVAILABLE' && bars.length === 0 && historyBars.length === 0 && (
        <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none">
          <div className="max-w-[560px] mx-4 px-5 py-4 rounded-lg border border-amber-500/40 bg-brand-surface/95 shadow-2xl text-center space-y-2">
            <div className="text-sm font-bold text-amber-400">FEED: UNAVAILABLE — {symbol}</div>
            <div className="text-[11px] text-slate-300">
              Real-time market data is unavailable (configuration, entitlement or connection). DeepChart is real-only: it
              will not display simulated ticks, generated depth, a reconstructed footprint or a synthetic volume
              profile.
            </div>
            <div className="text-[10px] text-slate-500">
              Configure Tradovate API access and market-data permissions for futures. BTCUSDT uses the public Binance feed.
            </div>
          </div>
        </div>
      )}

      {/* First-run primer (dismissible, remembered locally) */}
      <OnboardingCard symbol={symbol} />
    </div>
  );
};

export default App;

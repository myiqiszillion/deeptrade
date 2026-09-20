import React, { useEffect, useRef, useState } from 'react';
import { wsClient } from './services/websocket';
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
  VolumeProfileData,
  VWAPPoint,
} from './types';
import { FootprintCanvas } from './components/Chart/FootprintCanvas';
import { CVDPanel } from './components/Chart/CVDPanel';
import { DOMScalper } from './components/DOM/DOMScalper';
import { ProfileOverlay } from './components/Profile/ProfileOverlay';
import { SpeedOfTapeWidget } from './components/Tape/SpeedOfTapeWidget';
import { TickReplayWidget } from './components/Backtest/TickReplayWidget';
import { TradeCopierModal } from './components/Copier/TradeCopierModal';
import { TradingJournalModal } from './components/Journal/TradingJournalModal';
import { GEXPanel } from './components/Options/GEXPanel';
import { OptionsFlowWidget } from './components/Options/OptionsFlowWidget';
import { PropRiskMonitor } from './components/Prop/PropRiskMonitor';
import {
  Activity,
  Layers,
  BarChart2,
  Copy,
  BookOpen,
  Wifi,
  WifiOff,
  Shield,
  Flame,
  ChevronDown,
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

export const App: React.FC = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [symbol, setSymbol] = useState('ES');
  const [instrument, setInstrument] = useState<FuturesInstrument | undefined>();
  const [currentPrice, setCurrentPrice] = useState<number>(5850.0);

  // Core Data State
  const [bars, setBars] = useState<FootprintBar[]>([]);
  const [orderbook, setOrderbook] = useState<OrderbookSnapshot>({
    bids: [],
    asks: [],
    timestamp: Date.now(),
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

  // Prop Firm State
  const [propState, setPropState] = useState<PropAccountState | undefined>();
  const [propConfig, setPropConfig] = useState<PropAccountConfig | undefined>();

  // Order & replay protocol state
  const [openOrders, setOpenOrders] = useState<RestingOrder[]>([]);
  const [replayProgress, setReplayProgress] = useState<ReplayProgress | undefined>();
  const [notices, setNotices] = useState<{ id: number; kind: 'ok' | 'error'; text: string }[]>([]);
  const [breachAlert, setBreachAlert] = useState<string | undefined>();
  const [deepTradeThresholdUsd, setDeepTradeThresholdUsd] = useState<number | undefined>();

  // High-frequency tick buffering: ticks arrive every 30-120ms. Buffering them and
  // flushing to React state at ~8Hz keeps the Time & Sales tape lossless while cutting
  // the number of full component-tree re-renders.
  const pendingTicksRef = useRef<Tick[]>([]);
  const lastPriceRef = useRef<number | null>(null);
  const symbolRef = useRef('ES');

  const pushNotice = (kind: 'ok' | 'error', text: string) => {
    const id = Date.now() + Math.random();
    setNotices((prev) => [...prev.slice(-3), { id, kind, text }]);
    setTimeout(() => setNotices((prev) => prev.filter((n) => n.id !== id)), 3500);
  };

  // Features & Panels Toggles
  const [showDOM, setShowDOM] = useState(true);
  const [showProfile, setShowProfile] = useState(true);
  const [showTape, setShowTape] = useState(false);
  const [showGEX, setShowGEX] = useState(true);
  const [showOptionsFlow, setShowOptionsFlow] = useState(false);
  const [showVWAP, setShowVWAP] = useState(true);
  const [showImbalances, setShowImbalances] = useState(true);
  const [showDeltaNumbers, setShowDeltaNumbers] = useState(true);

  // Modals
  const [isCopierOpen, setIsCopierOpen] = useState(false);
  const [isJournalOpen, setIsJournalOpen] = useState(false);
  const [trades, setTrades] = useState<JournalTrade[]>([]);
  const [slaves, setSlaves] = useState<SlaveAccount[]>([
    { id: 'sub_1', name: 'Sub-Account #1 (Apex $50K)', multiplier: 1.0, enabled: true, status: 'connected' },
    { id: 'sub_2', name: 'Sub-Account #2 (Topstep $100K)', multiplier: 0.5, enabled: true, status: 'connected' },
  ]);

  // Connect WebSocket & Register Listeners
  useEffect(() => {
    wsClient.setListeners({
      onConnectionChange: (connected) => setIsConnected(connected),
      onInitState: (data) => {
        // A symbol switch (or reconnect) must reset per-instrument market state,
        // otherwise bars/tape from the previous contract stay on screen.
        if (data.symbol !== symbolRef.current) {
          symbolRef.current = data.symbol;
          pendingTicksRef.current = [];
          setBars([]);
          setRecentTicks([]);
          setDeepTrades([]);
          setAbsorptions([]);
          setOpenOrders([]);
        }
        setSymbol(data.symbol);
        setInstrument(data.instrument);
        if (typeof data.deepTradeThresholdUsd === 'number') setDeepTradeThresholdUsd(data.deepTradeThresholdUsd);
        setBars(data.bars);
        setOrderbook(data.orderbook);
        setVolumeProfile(data.volumeProfile);
        setTpoProfile(data.tpo);
        setVwapPoints(data.vwap);
        if (data.gexProfile) setGexProfile(data.gexProfile);
        if (data.optionsFlow) setOptionsFlow(data.optionsFlow);
        if (data.propState) setPropState(data.propState);
        if (data.propConfig) setPropConfig(data.propConfig);
        if (data.orderbook.asks[0]) {
          setCurrentPrice(data.orderbook.asks[0].price);
        }
      },
      onTick: (tick) => {
        pendingTicksRef.current.unshift(tick);
        lastPriceRef.current = tick.price;
      },
      onBarUpdate: (bar) => {
        setBars((prev) => {
          if (prev.length === 0) return [bar];
          const lastIdx = prev.length - 1;
          if (prev[lastIdx].id === bar.id) {
            const updated = [...prev];
            updated[lastIdx] = bar;
            return updated;
          }
          return [...prev, bar];
        });
        setCurrentCVD(bar.cvd);
      },
      onBarClose: (bar) => {
        setBars((prev) => [...prev.filter((b) => b.id !== bar.id), bar]);
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
      onGexUpdate: (gp) => {
        setGexProfile(gp);
      },
      onOptionsFlow: (flow) => {
        setOptionsFlow((prev) => [flow, ...prev.slice(0, 50)]);
      },
      onPropStateUpdate: (ps) => {
        setPropState(ps);
      },
      onPropBreachAlert: (alert) => {
        setBreachAlert(alert.message);
        pushNotice('error', `PROP BREACH (${alert.breachType})`);
      },
      onOpenOrders: (data) => {
        setOpenOrders(data.orders);
      },
      onOrderAck: (data) => {
        if (data.action === 'PLACED') {
          pushNotice('ok', `LIMIT resting: ${data.size} @ ${data.price?.toFixed(1)}`);
        } else if (data.action === 'FILLED') {
          pushNotice('ok', `Filled: ${data.size} @ ${data.price?.toFixed(1)}`);
        } else {
          pushNotice('ok', 'Order cancelled');
        }
      },
      onOrderReject: (data) => {
        pushNotice('error', `Rejected: ${data.reason}`);
      },
      onReplayState: (progress) => {
        setReplayProgress(progress);
      },
      onJournalUpdate: (trade) => {
        setTrades((prev) => {
          const idx = prev.findIndex((t) => t.id === trade.id);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = trade;
            return updated;
          }
          return [trade, ...prev];
        });
      },
      onTradeCopied: (copied) => {
        setSlaves((prev) =>
          prev.map((s) =>
            s.id === copied.slaveId
              ? {
                  ...s,
                  lastCopiedOrder: `${copied.size} contracts @ ${copied.price}`,
                  latencyMs: copied.latencyMs,
                }
              : s
          )
        );
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
    setSymbol(sym);
    const src = sym === 'BTCUSDT' ? 'binance' : 'cme';
    wsClient.subscribe(sym, src);
  };

  const handleCancelOrder = (orderId: string) => {
    wsClient.cancelOrder(orderId);
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
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-900/40 text-purple-300 font-bold border border-purple-500/30">
              PROP FIRM EDITION
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

          {/* Current Price Badge */}
          <span className="px-2.5 py-1 rounded bg-amber-500/15 text-amber-400 font-bold font-mono text-sm border border-amber-500/30">
            {currentPrice.toFixed(instrument ? (instrument.tickSize < 0.01 ? 3 : instrument.tickSize < 0.1 ? 2 : 1) : 2)}
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
            title="Toggle DOM Scalper"
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

          {/* Trade Copier */}
          <button
            onClick={() => setIsCopierOpen(true)}
            className="p-1 px-2 rounded bg-purple-600/20 text-purple-300 border border-purple-500/40 hover:bg-purple-600/30 flex items-center gap-1 text-xs font-semibold"
          >
            <Copy size={13} />
            <span>Copier</span>
          </button>

          {/* Journal */}
          <button
            onClick={() => setIsJournalOpen(true)}
            className="p-1 px-2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 flex items-center gap-1 text-xs font-semibold"
          >
            <BookOpen size={13} />
            <span>Journal</span>
          </button>

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

      {/* Prop Firm Safeguards HUD Bar */}
      <PropRiskMonitor state={propState} config={propConfig} />

      {/* Prop breach banner (kept in-app instead of a blocking window.alert) */}
      {breachAlert && (
        <div className="flex items-center justify-between px-4 py-1.5 bg-rose-600/90 text-white text-xs font-bold z-30">
          <span>PROP FIRM ALERT: {breachAlert} — trading is locked until reset.</span>
          <button
            onClick={() => setBreachAlert(undefined)}
            className="px-2 py-0.5 rounded bg-black/25 hover:bg-black/40 text-[10px]"
          >
            DISMISS
          </button>
        </div>
      )}

      {/* Order notices (ACK / REJECT feedback) */}
      {notices.length > 0 && (
        <div className="absolute top-16 right-3 z-40 space-y-1 pointer-events-none">
          {notices.map((n) => (
            <div
              key={n.id}
              className={`px-3 py-1.5 rounded shadow-lg text-[11px] font-mono border ${
                n.kind === 'ok'
                  ? 'bg-emerald-600/90 border-emerald-400/50 text-white'
                  : 'bg-rose-600/90 border-rose-400/50 text-white'
              }`}
            >
              {n.text}
            </div>
          ))}
        </div>
      )}

      {/* Main Content Workspace */}
      <div className="flex-1 flex overflow-hidden">
        {/* Center: Main Footprint Canvas & CVD Panel */}
        <div className="flex-1 flex flex-col min-w-0 h-full">
          <div className="flex-1 min-h-0 relative">
            <FootprintCanvas
              bars={bars}
              currentPrice={currentPrice}
              vwapPoints={vwapPoints}
              deepTrades={deepTrades}
              absorptions={absorptions}
              gexProfile={gexProfile}
              showVWAP={showVWAP}
              showImbalances={showImbalances}
              showDeltaNumbers={showDeltaNumbers}
              tickSize={instrument?.tickSize || 0.25}
            />
          </div>

          <CVDPanel bars={bars} currentCVD={currentCVD} />
        </div>

        {/* Right Side Panels */}
        {showGEX && <GEXPanel profile={gexProfile} currentPrice={currentPrice} />}

        {showOptionsFlow && <OptionsFlowWidget flowTrades={optionsFlow} />}

        {showProfile && (
          <ProfileOverlay
            volumeProfile={volumeProfile}
            tpoProfile={tpoProfile}
            currentPrice={currentPrice}
          />
        )}

        {showDOM && (
          <DOMScalper
            orderbook={orderbook}
            currentPrice={currentPrice}
            symbol={symbol}
            openOrders={openOrders}
            isLockedOut={propState?.isLockedOut === true}
            onCancelOrder={handleCancelOrder}
          />
        )}

        {showTape && (
          <SpeedOfTapeWidget
            tape={tape}
            recentTicks={recentTicks}
            deepTrades={deepTrades}
            symbol={symbol}
            deepTradeThresholdUsd={deepTradeThresholdUsd}
          />
        )}
      </div>

      {/* Bottom Footer: Backtest Every Tick */}
      <TickReplayWidget progress={replayProgress} />

      {/* Modals */}
      <TradeCopierModal
        isOpen={isCopierOpen}
        onClose={() => setIsCopierOpen(false)}
        slaves={slaves}
      />

      <TradingJournalModal
        isOpen={isJournalOpen}
        onClose={() => setIsJournalOpen(false)}
        trades={trades}
      />
    </div>
  );
};

export default App;

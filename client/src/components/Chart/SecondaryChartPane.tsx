import React, { useEffect, useRef, useState, useCallback } from 'react';
import { DeepChartWSClient } from '../../services/websocket';
import {
  FootprintBar,
  FuturesInstrument,
  HistoricalBar,
  VWAPPoint,
  DeepTrade,
  AbsorptionAlert,
  GEXProfile,
  ChartViewport,
} from '../../types';
import { FootprintCanvas } from './FootprintCanvas';
import { formatPrice } from '../../services/priceFormat';
import { X, Activity, Maximize2 } from 'lucide-react';
import { wsClient } from '../../services/websocket';

interface SecondaryChartPaneProps {
  id?: string;
  className?: string;
  initialSymbol?: string;
  initialTimeframe?: string;
  crosshairTime?: number | null;
  onCrosshairTimeChange?: (time: number | null) => void;
  onClose: () => void;
  onSymbolChange?: (symbol: string) => void;
}

const AVAILABLE_SYMBOLS = ['NQ', 'ES', 'MES', 'MNQ', 'YM', 'RTY', 'GC', 'CL'];
const AVAILABLE_TIMEFRAMES = ['1s', '5s', '15s', '30s', '1m', '5m', '15m', '1h'];

export const SecondaryChartPane: React.FC<SecondaryChartPaneProps> = ({
  id = 'pane2',
  className = '',
  initialSymbol = 'NQ',
  initialTimeframe = '1m',
  crosshairTime,
  onCrosshairTimeChange,
  onClose,
  onSymbolChange,
}) => {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [timeframe, setTimeframe] = useState(initialTimeframe);
  const [instrument, setInstrument] = useState<FuturesInstrument | undefined>();
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [bars, setBars] = useState<FootprintBar[]>([]);
  const [historyBars, setHistoryBars] = useState<HistoricalBar[]>([]);
  const [vwapPoints, setVwapPoints] = useState<VWAPPoint[]>([]);
  const [deepTrades, setDeepTrades] = useState<DeepTrade[]>([]);
  const [absorptions, setAbsorptions] = useState<AbsorptionAlert[]>([]);
  const [gexProfile, setGexProfile] = useState<GEXProfile | undefined>();
  const [feedStatus, setFeedStatus] = useState<'LIVE' | 'CONNECTING' | 'UNAVAILABLE'>('CONNECTING');
  const [isConnected, setIsConnected] = useState(wsClient.getFeedHealth().isConnected);
  const [viewport, setViewport] = useState<ChartViewport | undefined>();

  useEffect(() => {
    // Send subscribe command to multiplexer
    wsClient.send({
      type: 'SUBSCRIBE',
      symbol,
      timeframe,
    });

    wsClient.addListener(id, symbol, {
      onConnectionChange: (connected) => {
        setIsConnected(connected);
        if (!connected) setFeedStatus('UNAVAILABLE');
      },
      onInitState: (data) => {
        setSymbol(data.symbol);
        setInstrument(data.instrument);
        setBars(data.bars || []);
        setHistoryBars(data.historyBars || []);
        setVwapPoints(data.vwap || []);
        setGexProfile(data.gexProfile);
        setFeedStatus(data.feedStatus === 'LIVE' ? 'LIVE' : 'UNAVAILABLE');
        if (data.bars && data.bars.length > 0) {
          setCurrentPrice(data.bars[data.bars.length - 1].close);
        }
      },
      onTick: (tick) => {
        setCurrentPrice(tick.price);
        if (feedStatus !== 'LIVE') setFeedStatus('LIVE');
      },
      onBarUpdate: (bar) => {
        setBars((prev) => {
          if (prev.length === 0) return [bar];
          const last = prev[prev.length - 1];
          if (last.time === bar.time) {
            return [...prev.slice(0, -1), bar];
          }
          return [...prev, bar];
        });
        setCurrentPrice(bar.close);
      },
      onBarClose: (bar) => {
        setBars((prev) => {
          const idx = prev.findIndex((b) => b.time === bar.time);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = bar;
            return next;
          }
          return [...prev, bar];
        });
      },
      onVwapUpdate: (point) => {
        setVwapPoints((prev) => [...prev.slice(-300), point]);
      },
      onDeepTrade: (trade) => {
        setDeepTrades((prev) => [...prev.slice(-49), trade]);
      },
      onAbsorption: (alert) => {
        setAbsorptions((prev) => [...prev.slice(-49), alert]);
      },
      onGexUpdate: (gex) => {
        setGexProfile(gex);
      },
      onFeedStatusChange: (status) => {
        setFeedStatus(status === 'LIVE' ? 'LIVE' : 'UNAVAILABLE');
      },
    });

    return () => {
      wsClient.send({ type: 'UNSUBSCRIBE', symbol });
      wsClient.removeListener(id);
    };
  }, [id, symbol, timeframe]);

  const handleSelectSymbol = (newSym: string) => {
    setSymbol(newSym);
    setBars([]);
    setHistoryBars([]);
    setCurrentPrice(0);
    onSymbolChange?.(newSym);
  };

  const handleSelectTimeframe = (newTf: string) => {
    setTimeframe(newTf);
    setBars([]);
  };

  const tickSize = instrument?.tickSize || 0.25;

  return (
    <div className="secondary-chart-pane flex-1 flex flex-col h-full bg-[#0a0d12] border-l border-zinc-800 relative select-none">
      {/* Pane 2 Header Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800 bg-zinc-950/70 text-xs z-10">
        <div className="flex items-center gap-2">
          {/* Symbol Select */}
          <select
            value={symbol}
            onChange={(e) => handleSelectSymbol(e.target.value)}
            className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 font-mono font-bold text-white text-xs focus:outline-none"
            title="Pane 2 Symbol"
          >
            {AVAILABLE_SYMBOLS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          {/* Timeframe Select */}
          <div className="flex items-center gap-0.5 bg-zinc-900 rounded p-0.5 border border-zinc-800">
            {AVAILABLE_TIMEFRAMES.slice(3, 7).map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => handleSelectTimeframe(tf)}
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-medium transition-colors ${
                  timeframe === tf
                    ? 'bg-amber-500/20 text-amber-300 font-bold'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          {/* Last Price */}
          <div className="font-mono text-xs font-bold text-zinc-200 px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800">
            {currentPrice > 0 ? formatPrice(currentPrice, tickSize) : '—'}
          </div>

          {/* Feed Status */}
          <span
            className={`px-1.5 py-0.2 rounded text-[9px] font-bold tracking-wider uppercase ${
              feedStatus === 'LIVE'
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : 'bg-zinc-800 text-zinc-500'
            }`}
          >
            {feedStatus}
          </span>
        </div>

        {/* Close Pane Button */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono text-zinc-500 hidden sm:inline">Linked Time Cursor</span>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-800"
            title="Close Split Pane (Return to Single Chart)"
            aria-label="Close split pane"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Pane 2 Canvas Area */}
      <div className="flex-1 relative min-h-0">
        {(bars.length > 0 || historyBars.length > 0) ? (
          <FootprintCanvas
            bars={bars}
            historyBars={historyBars}
            isLive={feedStatus === 'LIVE'}
            sessionMode="LIVE"
            currentPrice={currentPrice}
            vwapPoints={vwapPoints}
            deepTrades={deepTrades}
            absorptions={absorptions}
            gexProfile={gexProfile}
            showVWAP={true}
            showImbalances={true}
            showDeltaNumbers={true}
            tickSize={tickSize}
            symbol={symbol}
            timeframe={timeframe}
            viewport={viewport}
            onViewportChange={setViewport}
            crosshairTime={crosshairTime}
            onCrosshairTimeChange={onCrosshairTimeChange}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-zinc-600 text-xs">
            <Activity size={24} className="mb-2 animate-pulse text-zinc-500" />
            <p className="font-mono">{symbol} · {timeframe}</p>
            <p className="text-[11px] text-zinc-500 mt-1">
              {isConnected ? 'Subscribed to market feed...' : 'Connecting to order flow engine...'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

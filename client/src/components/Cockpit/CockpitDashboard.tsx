import React, { useState } from 'react';
import {
  Activity,
  ArrowLeft,
  Compass,
  Cpu,
  Eye,
  Layers,
  Maximize2,
  Minimize2,
  Radio,
  RefreshCw,
  Sliders,
  TrendingDown,
  TrendingUp,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import {
  DeepTrade,
  FuturesInstrument,
  GEXProfile,
  OrderbookSnapshot,
  SpeedOfTapeData,
  Tick,
} from '../../types';
import { TelemetryRibbon } from './TelemetryRibbon';
import { OrderFlowRadar } from './OrderFlowRadar';
import { LiquidityMatrix } from './LiquidityMatrix';
import { GEXHorizon } from './GEXHorizon';
import { QuantumTape } from './QuantumTape';
import { SystemicRiskHUD } from './SystemicRiskHUD';
import { formatPrice } from '../../services/priceFormat';

interface CockpitDashboardProps {
  symbol: string;
  instrument?: FuturesInstrument;
  currentPrice: number;
  orderbook: OrderbookSnapshot;
  tape: SpeedOfTapeData;
  recentTicks: Tick[];
  deepTrades: DeepTrade[];
  gexProfile?: GEXProfile;
  isConnected: boolean;
  onSelectSymbol: (symbol: string) => void;
  onReturnToChart: () => void;
  highPrice?: number;
  lowPrice?: number;
}

const POPULAR_SYMBOLS = ['ES', 'NQ', 'SPY', 'QQQ', 'NVDA', 'BTC'];

export const CockpitDashboard: React.FC<CockpitDashboardProps> = ({
  symbol,
  instrument,
  currentPrice,
  orderbook,
  tape,
  recentTicks,
  deepTrades,
  gexProfile,
  isConnected,
  onSelectSymbol,
  onReturnToChart,
  highPrice,
  lowPrice,
}) => {
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const tickSize = instrument?.tickSize || 0.25;

  const toggleSound = () => setSoundEnabled((prev) => !prev);

  // Micro-change calculation from high/low
  const rangeMid = highPrice && lowPrice ? (highPrice + lowPrice) / 2 : currentPrice;
  const isUp = currentPrice >= rangeMid;

  return (
    <div className="cyber-cockpit-container cyber-grid-mesh flex-1 flex flex-col h-full w-full overflow-hidden select-none">
      {/* 1. Top Telemetry Ribbon */}
      <TelemetryRibbon
        symbol={symbol}
        currentPrice={currentPrice}
        tape={tape}
        isConnected={isConnected}
        soundEnabled={soundEnabled}
        onToggleSound={toggleSound}
      />

      {/* 2. Cockpit Command Header Bar */}
      <div className="bg-[#0B1017]/90 backdrop-blur-md border-b border-[#00f2fe]/20 px-4 py-2 flex flex-wrap items-center justify-between gap-3 shrink-0">
        {/* Left: Return button, Symbol Badge, Price HUD */}
        <div className="flex items-center gap-3">
          <button
            onClick={onReturnToChart}
            className="cyber-btn flex items-center gap-1.5 px-3 py-1 rounded text-xs font-mono font-bold"
            title="Return to standard Footprint Chart terminal"
          >
            <ArrowLeft size={14} />
            <span>CHART VIEW</span>
          </button>

          <div className="h-5 w-px bg-[#1C2630]" />

          {/* Current Symbol & Price Pill */}
          <div className="flex items-baseline gap-2 bg-[#06090e] px-3 py-1 rounded-md border border-[#00f2fe]/30 shadow-[0_0_12px_rgba(0,242,254,0.1)]">
            <span className="font-mono text-sm font-bold text-[#E7EDF3] tracking-wide">
              {symbol}
            </span>
            <span className="font-mono text-lg font-bold text-[#00f2fe] glow-text-cyan tabular-nums">
              {currentPrice > 0 ? formatPrice(currentPrice, tickSize) : '—'}
            </span>
            <span className={`text-xs font-mono font-semibold flex items-center ${isUp ? 'text-[#10b981]' : 'text-[#f43f5e]'}`}>
              {isUp ? <TrendingUp size={12} className="mr-0.5" /> : <TrendingDown size={12} className="mr-0.5" />}
              {isUp ? '+BULL' : '-BEAR'}
            </span>
          </div>

          {/* High / Low Session Range */}
          {highPrice !== undefined && lowPrice !== undefined && (
            <div className="hidden lg:flex items-center gap-2 font-mono text-[11px] text-[#7F8B97] bg-[#06090e] px-2.5 py-1 rounded border border-[#1C2630]">
              <span>H: <span className="text-[#10b981] font-bold">{formatPrice(highPrice, tickSize)}</span></span>
              <span>L: <span className="text-[#f43f5e] font-bold">{formatPrice(lowPrice, tickSize)}</span></span>
            </div>
          )}
        </div>

        {/* Center: Quick Symbol Switcher */}
        <div className="flex items-center gap-1 font-mono text-xs hidden md:flex">
          <span className="text-[10px] text-[#7F8B97] mr-1">HOT SYMBOLS:</span>
          {POPULAR_SYMBOLS.map((sym) => (
            <button
              key={sym}
              onClick={() => onSelectSymbol(sym)}
              className={`px-2 py-0.5 rounded text-[11px] font-bold transition-all ${
                symbol === sym
                  ? 'bg-[#00f2fe]/20 border border-[#00f2fe] text-[#00f2fe] shadow-[0_0_8px_rgba(0,242,254,0.35)]'
                  : 'bg-[#06090e] border border-[#1C2630] text-[#7F8B97] hover:text-[#E7EDF3] hover:border-[#25303A]'
              }`}
            >
              {sym}
            </button>
          ))}
        </div>

        {/* Right: Mode & Feed Badge */}
        <div className="flex items-center gap-2 font-mono text-xs">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#06090e] border border-[#00f2fe]/30 text-[#00f2fe] text-[11px]">
            <Radio size={13} className="text-[#00f2fe] animate-pulse" />
            <span className="font-bold">MISSION CONTROL</span>
          </div>
        </div>
      </div>

      {/* 3. Main Multi-Panel Cyber Matrix Grid */}
      <div className="flex-1 p-3 grid grid-cols-1 lg:grid-cols-12 gap-3 min-h-0 overflow-y-auto">
        {/* Left Column (4 cols): Order Flow Radar & Systemic Risk Telemetry */}
        <div className="lg:col-span-4 flex flex-col gap-3 min-h-0">
          <div className="flex-1 min-h-[340px]">
            <OrderFlowRadar
              symbol={symbol}
              currentPrice={currentPrice}
              orderbook={orderbook}
              deepTrades={deepTrades}
              recentTicks={recentTicks}
              soundEnabled={soundEnabled}
            />
          </div>
          <div className="shrink-0">
            <SystemicRiskHUD
              tape={tape}
              orderbook={orderbook}
              currentPrice={currentPrice}
            />
          </div>
        </div>

        {/* Center Column (4 cols): Liquidity Matrix & GEX Horizon */}
        <div className="lg:col-span-4 flex flex-col gap-3 min-h-0">
          <div className="flex-1 min-h-[300px]">
            <LiquidityMatrix
              orderbook={orderbook}
              currentPrice={currentPrice}
              tickSize={tickSize}
            />
          </div>
          <div className="flex-1 min-h-[260px]">
            <GEXHorizon
              gexProfile={gexProfile}
              currentPrice={currentPrice}
            />
          </div>
        </div>

        {/* Right Column (4 cols): Quantum Tape & Speedometer */}
        <div className="lg:col-span-4 flex flex-col min-h-0">
          <div className="h-full min-h-[500px]">
            <QuantumTape
              tape={tape}
              recentTicks={recentTicks}
              deepTrades={deepTrades}
              soundEnabled={soundEnabled}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

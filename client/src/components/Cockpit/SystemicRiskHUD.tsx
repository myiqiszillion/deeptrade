import React from 'react';
import { Activity, AlertTriangle, Disc, Flame, ShieldCheck, Waves } from 'lucide-react';
import { OrderbookSnapshot, SpeedOfTapeData } from '../../types';

interface SystemicRiskHUDProps {
  tape: SpeedOfTapeData;
  orderbook: OrderbookSnapshot;
  currentPrice: number;
}

interface GaugeCircleProps {
  label: string;
  sublabel: string;
  value: number; // 0 to 100
  displayVal: string;
  color: string;
  glowClass: string;
  statusText: string;
  statusTone: 'normal' | 'warn' | 'alert';
}

const CyberGauge: React.FC<GaugeCircleProps> = ({
  label,
  sublabel,
  value,
  displayVal,
  color,
  glowClass,
  statusText,
  statusTone,
}) => {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (Math.min(100, Math.max(0, value)) / 100) * circumference;

  return (
    <div className="flex flex-col items-center bg-[#06090e] p-2.5 rounded border border-[#1C2630] text-center">
      <div className="relative w-16 h-16 flex items-center justify-center">
        {/* Background track circle */}
        <svg className="w-full h-full -rotate-90" viewBox="0 0 64 64">
          <circle
            cx="32"
            cy="32"
            r={radius}
            fill="none"
            stroke="#16202c"
            strokeWidth="4"
          />
          {/* Animated Value Arc */}
          <circle
            cx="32"
            cy="32"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="4.5"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-500 ease-out"
          />
        </svg>

        {/* Center Display Value */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-xs font-bold font-mono tabular-nums ${glowClass}`} style={{ color }}>
            {displayVal}
          </span>
          <span className="text-[8px] text-[#7F8B97] font-mono mt-[-2px]">{sublabel}</span>
        </div>
      </div>

      {/* Label and Status */}
      <span className="text-[10px] font-bold text-[#E7EDF3] mt-1.5 font-mono tracking-wider uppercase">
        {label}
      </span>
      <span
        className={`text-[9px] font-mono mt-0.5 px-1.5 py-0.2 rounded ${
          statusTone === 'alert'
            ? 'bg-[#f43f5e]/20 text-[#f43f5e] font-bold animate-pulse'
            : statusTone === 'warn'
            ? 'bg-[#f59e0b]/20 text-[#f59e0b]'
            : 'bg-[#10b981]/15 text-[#10b981]'
        }`}
      >
        {statusText}
      </span>
    </div>
  );
};

export const SystemicRiskHUD: React.FC<SystemicRiskHUDProps> = ({ tape, orderbook }) => {
  // 1. Delta Momentum (0-100 scale where 50 is neutral)
  const buyRatio = tape?.buyRatio ?? 0.5;
  const deltaMomentum = Math.round(buyRatio * 100);

  // 2. Liquidity Exhaustion Score: High TPS with low book size implies exhaustion
  const tps = tape?.tps || 0;
  const totalBookSize =
    (orderbook?.bids?.slice(0, 5).reduce((acc, b) => acc + b.size, 0) || 100) +
    (orderbook?.asks?.slice(0, 5).reduce((acc, a) => acc + a.size, 0) || 100);
  const exhaustionRisk = Math.min(95, Math.max(12, Math.round((tps / (totalBookSize / 15)) * 40 + 20)));

  // 3. Volatility Squeeze Index
  const accel = Math.abs(tape?.acceleration || 0);
  const squeezeScore = Math.min(98, Math.max(15, Math.round(35 + accel * 12)));

  // 4. Order Book Tilt (Bid % of top 5 levels)
  const topBidSize = orderbook?.bids?.slice(0, 5).reduce((acc, b) => acc + b.size, 0) || 50;
  const topAskSize = orderbook?.asks?.slice(0, 5).reduce((acc, a) => acc + a.size, 0) || 50;
  const bookTilt = Math.round((topBidSize / (topBidSize + topAskSize || 1)) * 100);

  return (
    <div className="cyber-panel cyber-corner-brackets p-3 flex flex-col select-none font-mono">
      {/* Panel Header */}
      <div className="flex items-center justify-between border-b border-[#00f2fe]/20 pb-2 mb-2">
        <div className="flex items-center gap-2">
          <Disc size={14} className="text-[#00f2fe]" />
          <span className="text-xs font-bold text-[#E7EDF3] tracking-wider uppercase">
            Systemic Risk & Microstructure Telemetry
          </span>
        </div>
        <span className="cyber-badge px-1.5 py-0.5 rounded">REAL-TIME QUANT</span>
      </div>

      {/* 4 Circular HUD Gauges Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <CyberGauge
          label="Delta Momentum"
          sublabel="MOMENTUM"
          value={deltaMomentum}
          displayVal={`${deltaMomentum}%`}
          color={deltaMomentum >= 55 ? '#10b981' : deltaMomentum <= 45 ? '#f43f5e' : '#00f2fe'}
          glowClass={deltaMomentum >= 55 ? 'glow-text-emerald' : deltaMomentum <= 45 ? 'glow-text-rose' : 'glow-text-cyan'}
          statusText={deltaMomentum >= 60 ? 'BULL DOMINANCE' : deltaMomentum <= 40 ? 'BEAR PRESSURE' : 'BALANCED'}
          statusTone={deltaMomentum > 65 || deltaMomentum < 35 ? 'warn' : 'normal'}
        />

        <CyberGauge
          label="Exhaustion Risk"
          sublabel="EXHAUST"
          value={exhaustionRisk}
          displayVal={`${exhaustionRisk}%`}
          color={exhaustionRisk > 70 ? '#f43f5e' : exhaustionRisk > 45 ? '#f59e0b' : '#10b981'}
          glowClass={exhaustionRisk > 70 ? 'glow-text-rose' : 'glow-text-amber'}
          statusText={exhaustionRisk > 70 ? 'CRITICAL THINNING' : exhaustionRisk > 45 ? 'ELEVATED' : 'DEEP LIQUIDITY'}
          statusTone={exhaustionRisk > 70 ? 'alert' : exhaustionRisk > 45 ? 'warn' : 'normal'}
        />

        <CyberGauge
          label="Squeeze Potential"
          sublabel="SQUEEZE"
          value={squeezeScore}
          displayVal={`${squeezeScore}%`}
          color={squeezeScore > 75 ? '#8b5cf6' : '#00f2fe'}
          glowClass={squeezeScore > 75 ? 'glow-text-cyan' : 'glow-text-cyan'}
          statusText={squeezeScore > 75 ? 'IMMINENT BREAKOUT' : 'COMPRESSION'}
          statusTone={squeezeScore > 75 ? 'warn' : 'normal'}
        />

        <CyberGauge
          label="Book Skew"
          sublabel="BID/ASK"
          value={bookTilt}
          displayVal={`${bookTilt}%`}
          color={bookTilt >= 52 ? '#10b981' : bookTilt <= 48 ? '#f43f5e' : '#00f2fe'}
          glowClass={bookTilt >= 52 ? 'glow-text-emerald' : 'glow-text-rose'}
          statusText={bookTilt >= 55 ? 'BID HEAVY' : bookTilt <= 45 ? 'ASK HEAVY' : 'NEUTRAL'}
          statusTone="normal"
        />
      </div>
    </div>
  );
};

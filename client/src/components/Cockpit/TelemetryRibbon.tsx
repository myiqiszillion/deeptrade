import React, { useEffect, useState } from 'react';
import { Activity, Cpu, Radio, ShieldAlert, Volume2, VolumeX, Zap } from 'lucide-react';
import { SpeedOfTapeData } from '../../types';

interface TelemetryRibbonProps {
  symbol: string;
  currentPrice: number;
  tape: SpeedOfTapeData;
  isConnected: boolean;
  soundEnabled: boolean;
  onToggleSound: () => void;
  tickVelocity?: number;
}

export const TelemetryRibbon: React.FC<TelemetryRibbonProps> = ({
  symbol,
  currentPrice,
  tape,
  isConnected,
  soundEnabled,
  onToggleSound,
}) => {
  // Synthetic pulse calculation based on live TPS and buy/sell ratio
  const tps = tape.tps || 0;
  const buyRatio = tape.buyRatio || 0.5;
  const netDeltaSkew = Math.round((buyRatio - 0.5) * 200); // -100 to +100
  
  // Market pulse 0 - 100
  const pulseScore = Math.min(100, Math.max(10, Math.round(tps * 2.2 + 25)));
  
  // Simulated volatility index from current tape acceleration
  const volIndex = Math.min(99.9, Math.max(12.4, 18.5 + Math.abs(tape.acceleration || 0) * 0.8)).toFixed(1);

  // Sparkline data points
  const [sparkPoints, setSparkPoints] = useState<number[]>([40, 45, 52, 48, 60, 58, 65, 72, 68, 75, 82, 80]);

  useEffect(() => {
    const interval = setInterval(() => {
      setSparkPoints((prev) => {
        const nextVal = Math.max(20, Math.min(95, prev[prev.length - 1] + (Math.random() * 16 - 7.5)));
        return [...prev.slice(1), nextVal];
      });
    }, 1200);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="w-full bg-[#080d14]/90 backdrop-blur-md border-b border-[#00f2fe]/20 px-3 py-1.5 flex items-center justify-between gap-3 text-xs font-mono select-none overflow-x-auto">
      {/* 1. System Telemetry & Signal Status */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#00f2fe]/10 border border-[#00f2fe]/30 text-[#00f2fe] text-[10px] tracking-wider uppercase">
          <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-[#00f2fe] shadow-[0_0_8px_#00f2fe] animate-pulse' : 'bg-red-500'}`} />
          <span>CYBER-LINK 10G</span>
        </div>
        <div className="text-[#7F8B97] text-[11px] hidden sm:flex items-center gap-1">
          <Radio size={12} className="text-[#00f2fe]" />
          <span>FREQ: 1,000 Hz</span>
        </div>
      </div>

      {/* 2. Key Telemetry Gauges Ribbon */}
      <div className="flex items-center gap-4 shrink-0">
        {/* Market Pulse Index */}
        <div className="flex items-center gap-2 bg-[#0B1017] px-2.5 py-1 rounded border border-[#1C2630]">
          <Activity size={13} className={pulseScore > 65 ? 'text-[#ff007a] animate-bounce' : 'text-[#00f2fe]'} />
          <div className="flex flex-col">
            <span className="text-[9px] text-[#7F8B97] leading-none">MARKET PULSE</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className={`text-xs font-bold ${pulseScore > 65 ? 'text-[#ff007a] glow-text-rose' : 'text-[#00f2fe] glow-text-cyan'}`}>
                {pulseScore}
              </span>
              <span className="text-[9px] text-[#4E5965]">/100</span>
            </div>
          </div>
          {/* Mini pulse wave SVG */}
          <svg className="w-12 h-4 overflow-visible ml-1" viewBox="0 0 48 16">
            <path
              d="M0,8 L10,8 L14,2 L18,14 L22,4 L26,11 L30,8 L48,8"
              fill="none"
              stroke={pulseScore > 65 ? '#ff007a' : '#00f2fe'}
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </div>

        {/* Quantum Volatility Sparkline */}
        <div className="flex items-center gap-2 bg-[#0B1017] px-2.5 py-1 rounded border border-[#1C2630] hidden md:flex">
          <Zap size={13} className="text-[#f59e0b]" />
          <div className="flex flex-col">
            <span className="text-[9px] text-[#7F8B97] leading-none">QUANTUM VOL</span>
            <span className="text-xs font-bold text-[#f59e0b] glow-text-amber mt-0.5">
              {volIndex}σ
            </span>
          </div>
          {/* Mini live sparkline */}
          <div className="w-16 h-4 flex items-end gap-0.5 ml-1">
            {sparkPoints.map((val, idx) => (
              <div
                key={idx}
                className="w-1 rounded-t bg-[#f59e0b]/70 transition-all duration-300"
                style={{ height: `${(val / 100) * 16}px` }}
              />
            ))}
          </div>
        </div>

        {/* Aggressor Delta Skew Bar */}
        <div className="flex items-center gap-2 bg-[#0B1017] px-2.5 py-1 rounded border border-[#1C2630] min-w-[140px]">
          <div className="flex flex-col flex-1">
            <div className="flex justify-between text-[9px] text-[#7F8B97] leading-none mb-1">
              <span>SKEW</span>
              <span className={netDeltaSkew >= 0 ? 'text-[#10b981]' : 'text-[#f43f5e]'}>
                {netDeltaSkew > 0 ? `+${netDeltaSkew}% BUY` : `${netDeltaSkew}% SELL`}
              </span>
            </div>
            {/* Split directional meter */}
            <div className="h-1.5 w-full bg-[#16202c] rounded-full overflow-hidden flex">
              <div
                className="h-full bg-[#f43f5e] transition-all duration-200"
                style={{ width: `${Math.max(0, -netDeltaSkew)}%`, marginLeft: 'auto' }}
              />
              <div className="w-0.5 h-full bg-white/40" />
              <div
                className="h-full bg-[#10b981] transition-all duration-200"
                style={{ width: `${Math.max(0, netDeltaSkew)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Tick Velocity */}
        <div className="flex items-center gap-2 bg-[#0B1017] px-2.5 py-1 rounded border border-[#1C2630] hidden lg:flex">
          <Cpu size={13} className="text-[#8b5cf6]" />
          <div className="flex flex-col">
            <span className="text-[9px] text-[#7F8B97] leading-none">FLOW TPS</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-xs font-bold text-[#8b5cf6]">{tps.toFixed(1)}</span>
              <span className="text-[9px] text-[#7F8B97]">ticks/s</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Audio & System HUD Controls */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onToggleSound}
          className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[11px] transition-colors ${
            soundEnabled
              ? 'bg-[#00f2fe]/10 border-[#00f2fe]/40 text-[#00f2fe]'
              : 'bg-[#0B1017] border-[#1C2630] text-[#7F8B97] hover:text-[#E7EDF3]'
          }`}
          title={soundEnabled ? 'Synthesized cyber audio telemetry ON' : 'Audio muted'}
        >
          {soundEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
          <span className="hidden sm:inline">{soundEnabled ? 'AUDIO ON' : 'AUDIO OFF'}</span>
        </button>
      </div>
    </div>
  );
};

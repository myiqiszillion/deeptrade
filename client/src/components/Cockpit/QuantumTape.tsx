import React, { useEffect, useRef } from 'react';
import { Gauge, Radio, ShieldAlert, Sparkles, Zap } from 'lucide-react';
import { DeepTrade, SpeedOfTapeData, Tick } from '../../types';

interface QuantumTapeProps {
  tape: SpeedOfTapeData;
  recentTicks: Tick[];
  deepTrades: DeepTrade[];
  soundEnabled?: boolean;
}

export const QuantumTape: React.FC<QuantumTapeProps> = ({
  tape,
  recentTicks,
  deepTrades,
  soundEnabled,
}) => {
  const tps = tape?.tps || 0;
  const acceleration = tape?.acceleration || 0;
  const recentWhale = deepTrades?.[0];

  // Synthesize Web Audio chirp on whale trade arrival
  const lastWhaleIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!soundEnabled || !recentWhale || recentWhale.id === lastWhaleIdRef.current) return;
    lastWhaleIdRef.current = recentWhale.id;

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = recentWhale.side === 'buy' ? 'triangle' : 'sawtooth';
      osc.frequency.setValueAtTime(recentWhale.side === 'buy' ? 880 : 440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(recentWhale.side === 'buy' ? 1760 : 220, ctx.currentTime + 0.12);

      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch {
      // Audio context may be restricted by autoplay policy
    }
  }, [recentWhale, soundEnabled]);

  // Speedometer needle angle calculation: 0 TPS = -90 deg, 50 TPS = +90 deg
  const maxTPS = 50;
  const clampedTPS = Math.min(maxTPS, Math.max(0, tps));
  const needleAngle = -90 + (clampedTPS / maxTPS) * 180;

  return (
    <div className="cyber-panel cyber-corner-brackets p-3 flex flex-col h-full select-none font-mono">
      {/* Panel Header */}
      <div className="flex items-center justify-between border-b border-[#00f2fe]/20 pb-2 mb-2">
        <div className="flex items-center gap-2">
          <Zap size={14} className="text-[#00f2fe]" />
          <span className="text-xs font-bold text-[#E7EDF3] tracking-wider uppercase">
            Quantum Tape & Speed
          </span>
          <span className="cyber-badge px-1.5 py-0.5 rounded">HFT MICRO-STREAM</span>
        </div>

        <div className="text-[10px] text-[#7F8B97] flex items-center gap-1">
          <span>ACCEL:</span>
          <span className={acceleration >= 0 ? 'text-[#10b981]' : 'text-[#f43f5e]'}>
            {acceleration >= 0 ? `+${acceleration.toFixed(1)}` : acceleration.toFixed(1)}
          </span>
        </div>
      </div>

      {/* Speedometer Section */}
      <div className="flex items-center justify-around bg-[#06090e] p-2 rounded border border-[#1C2630] mb-2">
        {/* SVG Speedometer Arc */}
        <div className="relative w-28 h-16 flex items-end justify-center overflow-hidden">
          <svg viewBox="0 0 100 55" className="w-full h-full">
            {/* Background Arc */}
            <path
              d="M 10 50 A 40 40 0 0 1 90 50"
              fill="none"
              stroke="#1C2630"
              strokeWidth="6"
              strokeLinecap="round"
            />
            {/* Active Gauge Arc */}
            <path
              d="M 10 50 A 40 40 0 0 1 90 50"
              fill="none"
              stroke="url(#speedGrad)"
              strokeWidth="6"
              strokeDasharray="125.6"
              strokeDashoffset={125.6 - (clampedTPS / maxTPS) * 125.6}
              strokeLinecap="round"
              className="transition-all duration-300"
            />
            <defs>
              <linearGradient id="speedGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#00f2fe" />
                <stop offset="60%" stopColor="#10b981" />
                <stop offset="90%" stopColor="#ff007a" />
              </linearGradient>
            </defs>
            {/* Center Pivot & Needle */}
            <circle cx="50" cy="50" r="4" fill="#00f2fe" />
            <line
              x1="50"
              y1="50"
              x2="50"
              y2="16"
              stroke="#E7EDF3"
              strokeWidth="2"
              strokeLinecap="round"
              transform={`rotate(${needleAngle} 50 50)`}
              className="transition-transform duration-200"
            />
          </svg>
        </div>

        {/* Speedometer Value Readout */}
        <div className="flex flex-col text-right">
          <span className="text-[9px] text-[#7F8B97]">TAPE VELOCITY</span>
          <div className="flex items-baseline justify-end gap-1">
            <span className="text-xl font-bold text-[#00f2fe] glow-text-cyan tabular-nums">
              {tps.toFixed(1)}
            </span>
            <span className="text-[10px] text-[#7F8B97]">TPS</span>
          </div>
          <span className="text-[9px] text-[#4E5965] mt-0.5">
            {tps > 30 ? 'BURST SPIKE' : tps > 15 ? 'ACTIVE FLOW' : 'STEADY PULSE'}
          </span>
        </div>
      </div>

      {/* Whale Alert Ribbon if recent */}
      {recentWhale && (
        <div
          className={`mb-2 px-2 py-1 rounded flex items-center justify-between text-[10px] border ${
            recentWhale.side === 'buy'
              ? 'bg-[#10b981]/10 border-[#10b981]/40 text-[#10b981]'
              : 'bg-[#f43f5e]/10 border-[#f43f5e]/40 text-[#f43f5e]'
          }`}
        >
          <span className="flex items-center gap-1 font-bold">
            <Sparkles size={11} className="animate-spin" />
            WHALE {recentWhale.side.toUpperCase()}
          </span>
          <span className="tabular-nums font-semibold">
            ${(recentWhale.valueUsd / 1000).toFixed(0)}k @ {recentWhale.price.toFixed(2)} ({recentWhale.size}L)
          </span>
        </div>
      )}

      {/* Microsecond Tape Stream Rows */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-1 pr-1 text-[11px]">
        {recentTicks && recentTicks.length > 0 ? (
          recentTicks.slice(0, 16).map((t, idx) => {
            const isBuy = t.side === 'buy';
            const isLarge = t.size >= 10;
            const timeStr = new Date(t.timestamp).toTimeString().slice(0, 8);

            return (
              <div
                key={`tick-${t.id || idx}`}
                className={`flex items-center justify-between px-1.5 py-0.5 rounded text-xs transition-colors ${
                  isLarge
                    ? isBuy
                      ? 'bg-[#10b981]/15 border-l-2 border-[#10b981]'
                      : 'bg-[#f43f5e]/15 border-l-2 border-[#f43f5e]'
                    : 'bg-[#0B1017]/80 hover:bg-[#111720]'
                }`}
              >
                <span className="text-[10px] text-[#7F8B97] tabular-nums">{timeStr}</span>
                <span className={`font-bold tabular-nums ${isBuy ? 'text-[#10b981]' : 'text-[#f43f5e]'}`}>
                  {t.price.toFixed(2)}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className={`text-[10px] px-1 rounded font-semibold ${isBuy ? 'bg-[#10b981]/20 text-[#10b981]' : 'bg-[#f43f5e]/20 text-[#f43f5e]'}`}>
                    {isBuy ? 'BUY' : 'SELL'}
                  </span>
                  <span className="font-bold tabular-nums text-[#E7EDF3] min-w-[24px] text-right">
                    {t.size}
                  </span>
                </div>
              </div>
            );
          })
        ) : (
          <div className="text-[10px] text-[#4E5965] py-4 text-center">Awaiting Quantum Tick Stream...</div>
        )}
      </div>
    </div>
  );
};

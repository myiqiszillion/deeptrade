import React, { useState } from 'react';
import { GEXProfile } from '../../types';
import { Shield, TrendingUp, AlertCircle } from 'lucide-react';

interface GEXPanelProps {
  profile?: GEXProfile;
  currentPrice: number;
}

export const GEXPanel: React.FC<GEXPanelProps> = ({ profile, currentPrice }) => {
  const [show0DteOnly, setShow0DteOnly] = useState(false);

  if (!profile) {
    return (
      <div className="w-80 h-full border-l border-brand-border bg-brand-surface p-4 text-slate-500 text-center flex flex-col justify-center text-xs">
        <span>No Gamma Exposure data available for this symbol.</span>
        <span className="text-[10px] mt-1 text-slate-600">Select ES, NQ, SPX, or SPY to view GEX.</span>
      </div>
    );
  }

  const levels = profile.levels;
  const maxGex = Math.max(1, ...levels.map((l) => Math.max(l.callGex, Math.abs(l.putGex))));

  return (
    <div className="w-80 h-full border-l border-brand-border bg-brand-surface flex flex-col select-none font-mono text-xs">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-brand-border px-3 py-2 bg-brand-surfaceHover">
        <div className="flex items-center gap-1.5 font-bold text-slate-200">
          <Shield size={14} className="text-amber-400" />
          <span>GAMMA EXPOSURE (GEX)</span>
        </div>
        <span className="text-[10px] px-1.5 py-0.5 bg-brand-bg text-amber-400 rounded font-bold">
          {profile.underlying}
        </span>
      </div>

      {/* GEX Metrics Cards */}
      <div className="p-3 border-b border-brand-border bg-brand-bg/40 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-slate-400 text-[11px]">Dealer Regime:</span>
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
              profile.regime === 'POSITIVE_GAMMA'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
            }`}
          >
            {profile.regime === 'POSITIVE_GAMMA' ? '+ GAMMA (Mean Reverting)' : '- GAMMA (High Volatility)'}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-1 text-[10px] text-center pt-1">
          <div className="p-1.5 bg-brand-surface rounded border border-brand-border">
            <div className="text-slate-500">Put Wall</div>
            <div className="text-rose-400 font-bold text-[11px]">{profile.putWall}</div>
          </div>
          <div className="p-1.5 bg-brand-surface rounded border border-brand-border">
            <div className="text-slate-500">Zero Gamma</div>
            <div className="text-amber-400 font-bold text-[11px]">{profile.zeroGammaFlip}</div>
          </div>
          <div className="p-1.5 bg-brand-surface rounded border border-brand-border">
            <div className="text-slate-500">Call Wall</div>
            <div className="text-emerald-400 font-bold text-[11px]">{profile.callWall}</div>
          </div>
        </div>

        <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1">
          <span>Net GEX: <b className="text-slate-200">{profile.totalNetGex}M</b></span>
          <span>0DTE GEX: <b className="text-amber-300">{profile.total0DteGex}M</b></span>
        </div>

        {/* 0DTE Filter Toggle */}
        <div className="flex items-center justify-between pt-1">
          <span className="text-[10px] text-slate-400">View Mode:</span>
          <button
            onClick={() => setShow0DteOnly(!show0DteOnly)}
            className={`px-2 py-0.5 rounded text-[10px] ${
              show0DteOnly ? 'bg-amber-500 text-black font-bold' : 'bg-slate-800 text-slate-300'
            }`}
          >
            {show0DteOnly ? '0DTE Only' : 'Total GEX'}
          </button>
        </div>
      </div>

      {/* Strike by Strike GEX Distribution */}
      <div className="flex-1 overflow-y-auto divide-y divide-brand-border/20 text-[10px]">
        {levels.map((lvl) => {
          const isCallWall = lvl.strike === profile.callWall;
          const isPutWall = lvl.strike === profile.putWall;
          const isZeroFlip = lvl.strike === profile.zeroGammaFlip;
          const isAtTheMoney = Math.abs(lvl.strike - currentPrice) <= 5;

          const gexValue = show0DteOnly ? lvl.zeroDteGex : lvl.netGex;
          const callWidth = Math.min(50, (lvl.callGex / maxGex) * 50);
          const putWidth = Math.min(50, (Math.abs(lvl.putGex) / maxGex) * 50);

          return (
            <div
              key={lvl.strike}
              className={`relative flex items-center justify-between px-3 py-1 hover:bg-white/5 ${
                isAtTheMoney ? 'bg-amber-500/10' : ''
              }`}
            >
              {/* Put GEX bar (Left) */}
              <div className="w-16 h-3 bg-brand-bg rounded overflow-hidden flex justify-end">
                <div className="bg-rose-500/60 h-full" style={{ width: `${putWidth}%` }} />
              </div>

              {/* Strike & Badges */}
              <div className="flex items-center gap-1 z-10">
                <span
                  className={`font-bold ${
                    isCallWall
                      ? 'text-emerald-400'
                      : isPutWall
                      ? 'text-rose-400'
                      : isZeroFlip
                      ? 'text-amber-400'
                      : 'text-slate-300'
                  }`}
                >
                  {lvl.strike}
                </span>
                {isCallWall && <span className="text-[8px] px-1 bg-emerald-500/20 text-emerald-400 rounded">CW</span>}
                {isPutWall && <span className="text-[8px] px-1 bg-rose-500/20 text-rose-400 rounded">PW</span>}
                {isZeroFlip && <span className="text-[8px] px-1 bg-amber-500/20 text-amber-400 rounded">0-FLIP</span>}
              </div>

              {/* Call GEX bar (Right) */}
              <div className="w-16 h-3 bg-brand-bg rounded overflow-hidden flex justify-start">
                <div className="bg-emerald-500/60 h-full" style={{ width: `${callWidth}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

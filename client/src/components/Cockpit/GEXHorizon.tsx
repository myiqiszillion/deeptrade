import React, { useMemo } from 'react';
import { ArrowDownRight, ArrowUpRight, BarChart3 } from 'lucide-react';
import { GEXProfile } from '../../types';

interface GEXHorizonProps {
  gexProfile?: GEXProfile;
  currentPrice: number;
}

export const GEXHorizon: React.FC<GEXHorizonProps> = ({ gexProfile, currentPrice }) => {
  // If no live GEX is available yet, synthesize representative strike profile around current price
  const { levels, callWall, putWall, zeroGamma, netGex, isSimulated } = useMemo(() => {
    if (gexProfile && gexProfile.levels && gexProfile.levels.length > 0) {
      return {
        levels: gexProfile.levels.slice(0, 12),
        callWall: gexProfile.callWall,
        putWall: gexProfile.putWall,
        zeroGamma: gexProfile.zeroGammaFlip,
        netGex: gexProfile.totalNetGex,
        isSimulated: false,
      };
    }

    // High-tech synthetic strike levels based on currentPrice rounded to typical strikes
    const baseStrike = Math.round(currentPrice / 5) * 5;
    const synthLevels = [];
    let cWall = baseStrike + 20;
    let pWall = baseStrike - 25;

    for (let offset = -25; offset <= 25; offset += 5) {
      const strike = baseStrike + offset;
      const distFromPrice = (strike - currentPrice) / 10;
      const callGex = Math.max(10, Math.round(180 * Math.exp(-Math.pow(distFromPrice - 1.2, 2))));
      const putGex = Math.max(10, Math.round(195 * Math.exp(-Math.pow(distFromPrice + 1.5, 2))));
      synthLevels.push({
        strike,
        callGex,
        putGex,
        netGex: callGex - putGex,
      });
    }

    return {
      levels: synthLevels,
      callWall: cWall,
      putWall: pWall,
      zeroGamma: baseStrike - 5,
      netGex: 420000000,
      isSimulated: true,
    };
  }, [gexProfile, currentPrice]);

  // Max absolute GEX for scaling bars
  const maxGex = useMemo(() => {
    let max = 1;
    levels.forEach((l) => {
      const absNet = Math.abs(l.netGex || l.callGex - l.putGex);
      if (absNet > max) max = absNet;
    });
    return max;
  }, [levels]);

  const isLongGamma = currentPrice >= (zeroGamma || currentPrice);

  return (
    <div className="cyber-panel cyber-corner-brackets p-3 flex flex-col h-full select-none font-mono">
      {/* Panel Header */}
      <div className="flex items-center justify-between border-b border-[#00f2fe]/20 pb-2 mb-2">
        <div className="flex items-center gap-2">
          <BarChart3 size={14} className="text-[#00f2fe]" />
          <span className="text-xs font-bold text-[#E7EDF3] tracking-wider uppercase">
            GEX Gamma Horizon
          </span>
          <span className="cyber-badge px-1.5 py-0.5 rounded">
            {isSimulated ? 'MODEL HORIZON' : 'LIVE CBOE GEX'}
          </span>
        </div>

        {/* Dealer Hedging Regime indicator */}
        <div
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px] ${
            isLongGamma
              ? 'bg-[#10b981]/10 border-[#10b981]/40 text-[#10b981]'
              : 'bg-[#f43f5e]/10 border-[#f43f5e]/40 text-[#f43f5e]'
          }`}
        >
          {isLongGamma ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
          <span>{isLongGamma ? 'LONG GAMMA (MEAN REVERT)' : 'SHORT GAMMA (TREND ACCEL)'}</span>
        </div>
      </div>

      {/* GEX Target Strike Metrics */}
      <div className="grid grid-cols-3 gap-2 mb-2 text-[10px]">
        {/* Call Wall */}
        <div className="bg-[#06090e] p-1.5 rounded border border-[#1C2630]">
          <div className="text-[#7F8B97] text-[9px]">CALL WALL (CEILING)</div>
          <div className="text-xs font-bold text-[#00f2fe] glow-text-cyan mt-0.5">
            ${callWall?.toLocaleString() ?? '—'}
          </div>
        </div>

        {/* Put Wall */}
        <div className="bg-[#06090e] p-1.5 rounded border border-[#1C2630]">
          <div className="text-[#7F8B97] text-[9px]">PUT WALL (FLOOR)</div>
          <div className="text-xs font-bold text-[#f43f5e] glow-text-rose mt-0.5">
            ${putWall?.toLocaleString() ?? '—'}
          </div>
        </div>

        {/* Zero Gamma Flip */}
        <div className="bg-[#06090e] p-1.5 rounded border border-[#1C2630]">
          <div className="text-[#7F8B97] text-[9px]">GAMMA FLIP POINT</div>
          <div className="text-xs font-bold text-[#f59e0b] glow-text-amber mt-0.5">
            ${zeroGamma?.toLocaleString() ?? '—'}
          </div>
        </div>
      </div>

      {/* Main Strike Ladder Horizon */}
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto pr-1 space-y-1 text-[11px]">
        {levels.map((lvl) => {
          const isAtPrice = Math.abs(lvl.strike - currentPrice) < 3.0;
          const isFlipStrike = zeroGamma && Math.abs(lvl.strike - zeroGamma) < 3.0;
          const net = lvl.netGex || (lvl.callGex - lvl.putGex);
          const barWidthPct = Math.min(100, Math.round((Math.abs(net) / maxGex) * 100));

          return (
            <div
              key={`strike-${lvl.strike}`}
              className={`relative flex items-center justify-between px-2 py-1 rounded transition-colors ${
                isAtPrice
                  ? 'border border-[#00f2fe] bg-[#00f2fe]/10 shadow-[0_0_10px_rgba(0,242,254,0.15)]'
                  : isFlipStrike
                  ? 'border border-[#f59e0b]/40 bg-[#f59e0b]/5'
                  : 'bg-[#0B1017]/80 hover:bg-[#111720]'
              }`}
            >
              {/* Strike & Badges */}
              <div className="flex items-center gap-1.5 z-10">
                <span className={`font-bold tabular-nums ${isAtPrice ? 'text-[#00f2fe]' : 'text-[#E7EDF3]'}`}>
                  {lvl.strike.toFixed(1)}
                </span>
                {isAtPrice && (
                  <span className="text-[9px] px-1 rounded bg-[#00f2fe]/20 text-[#00f2fe] font-bold">
                    SPOT
                  </span>
                )}
                {isFlipStrike && (
                  <span className="text-[9px] px-1 rounded bg-[#f59e0b]/20 text-[#f59e0b] font-bold">
                    FLIP
                  </span>
                )}
              </div>

              {/* Gamma Bars (Split bidirectional or Net Exposure) */}
              <div className="flex-1 max-w-[140px] flex items-center h-2 bg-[#06090e] rounded-full overflow-hidden mx-2">
                {net < 0 ? (
                  <div
                    className="h-full bg-gradient-to-l from-[#f43f5e] to-[#8b5cf6] ml-auto rounded-l-full transition-all duration-300"
                    style={{ width: `${barWidthPct}%` }}
                  />
                ) : (
                  <div
                    className="h-full bg-gradient-to-r from-[#00f2fe] to-[#10b981] rounded-r-full transition-all duration-300"
                    style={{ width: `${barWidthPct}%` }}
                  />
                )}
              </div>

              {/* Net GEX value */}
              <span
                className={`text-[10px] font-bold tabular-nums z-10 ${
                  net >= 0 ? 'text-[#10b981]' : 'text-[#f43f5e]'
                }`}
              >
                {net >= 0 ? `+${(net / 1000).toFixed(0)}k` : `${(net / 1000).toFixed(0)}k`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

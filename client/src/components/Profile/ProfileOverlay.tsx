import React, { useState, useMemo } from 'react';
import { TPOProfileData, VolumeProfileData } from '../../types';
import { formatPrice, formatVolume } from '../../services/priceFormat';

interface ProfileOverlayProps {
  volumeProfile: VolumeProfileData;
  tpoProfile: TPOProfileData;
  currentPrice: number;
  tickSize?: number;
}

export const ProfileOverlay: React.FC<ProfileOverlayProps> = ({
  volumeProfile,
  tpoProfile,
  currentPrice,
  tickSize = 0.5,
}) => {
  const [activeTab, setActiveTab] = useState<'VP' | 'TPO'>('VP');

  const maxVolume = Math.max(1, ...volumeProfile.levels.map((l) => l.volume));

  // Sort descending by price
  const sortedVpLevels = useMemo(() => {
    return [...volumeProfile.levels].sort((a, b) => b.price - a.price);
  }, [volumeProfile.levels]);

  // Dynamic TPO price grouping so tight tick sizes (e.g. BTC 0.1) show real market profile distribution
  const aggregatedTpo = useMemo(() => {
    const rawPrices = Object.keys(tpoProfile.priceLevels).map(Number).sort((a, b) => b - a);
    const step = tickSize < 1 ? Math.max(1, tickSize * 10) : tickSize;

    const buckets = new Map<number, string[]>();
    for (const p of rawPrices) {
      const bucketKey = Number((Math.floor(p / step + 1e-9) * step).toFixed(4));
      const existing = buckets.get(bucketKey) || [];
      const chars = tpoProfile.priceLevels[p] || [];
      for (const c of chars) {
        if (!existing.includes(c)) existing.push(c);
      }
      buckets.set(bucketKey, existing.sort());
    }

    const prices = Array.from(buckets.keys()).sort((a, b) => b - a);
    return { prices, buckets };
  }, [tpoProfile.priceLevels, tickSize]);

  return (
    <div className="w-full h-full flex flex-col select-none text-xs bg-slate-950/40 font-mono">
      {/* Header Tabs */}
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-2 bg-slate-900/50">
        <div className="flex gap-1.5 p-0.5 rounded-lg bg-slate-950/60 border border-white/5">
          <button
            onClick={() => setActiveTab('VP')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
              activeTab === 'VP'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 shadow-[0_0_8px_rgba(245,158,11,0.2)]'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Volume Profile
          </button>
          <button
            onClick={() => setActiveTab('TPO')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
              activeTab === 'TPO'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30 shadow-[0_0_8px_rgba(14,165,233,0.2)]'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Market Profile (TPO)
          </button>
        </div>
        {currentPrice > 0 && (
          <span className="text-[10px] text-amber-400/90 font-mono">
            {formatPrice(currentPrice, tickSize)}
          </span>
        )}
      </div>

      {/* Profile Metrics Bar */}
      <div className="grid grid-cols-3 gap-2 px-3 py-2 bg-slate-900/80 border-b border-white/5 text-slate-300 font-mono text-[11px]">
        <div className="flex items-center justify-between bg-white/[0.03] px-2 py-1 rounded border border-white/5">
          <span className="text-slate-400 text-[10px] font-sans">VAH:</span>
          <span className="text-sky-400 font-bold tabular-nums">
            {(activeTab === 'VP' ? volumeProfile.vah : tpoProfile.vah) > 0
              ? formatPrice(activeTab === 'VP' ? volumeProfile.vah : tpoProfile.vah, tickSize)
              : '—'}
          </span>
        </div>
        <div className="flex items-center justify-between bg-amber-500/10 px-2 py-1 rounded border border-amber-500/20">
          <span className="text-amber-400/80 text-[10px] font-sans">POC:</span>
          <span className="text-amber-300 font-bold tabular-nums">
            {(activeTab === 'VP' ? volumeProfile.poc : tpoProfile.poc) > 0
              ? formatPrice(activeTab === 'VP' ? volumeProfile.poc : tpoProfile.poc, tickSize)
              : '—'}
          </span>
        </div>
        <div className="flex items-center justify-between bg-white/[0.03] px-2 py-1 rounded border border-white/5">
          <span className="text-slate-400 text-[10px] font-sans">VAL:</span>
          <span className="text-sky-400 font-bold tabular-nums">
            {(activeTab === 'VP' ? volumeProfile.val : tpoProfile.val) > 0
              ? formatPrice(activeTab === 'VP' ? volumeProfile.val : tpoProfile.val, tickSize)
              : '—'}
          </span>
        </div>
      </div>

      {/* Main Profile View */}
      <div className="flex-1 overflow-y-auto font-mono text-[10px] custom-scrollbar flex flex-col">
        {activeTab === 'VP' ? (
          sortedVpLevels.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500 font-sans text-xs gap-2 my-auto">
              <span className="font-semibold text-slate-400 text-[11px]">VOLUME PROFILE UNAVAILABLE</span>
              <span className="text-[10px] text-slate-500 max-w-[200px]">
                No volume distribution data available yet for this instrument session.
              </span>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.03]">
              {sortedVpLevels.slice(0, 100).map((lvl) => {
                const isPOC = Math.abs(lvl.price - volumeProfile.poc) < (tickSize || 0.1);
                const isVAH = Math.abs(lvl.price - volumeProfile.vah) < (tickSize || 0.1);
                const isVAL = Math.abs(lvl.price - volumeProfile.val) < (tickSize || 0.1);
                const isCurrent = Math.abs(lvl.price - currentPrice) < (tickSize ? tickSize * 2 : 0.5);
                const barPercent = Math.min(100, (lvl.volume / maxVolume) * 100);

                return (
                  <div
                    key={lvl.price}
                    className={`relative flex items-center justify-between px-2.5 py-1 hover:bg-white/5 transition-colors ${
                      isCurrent ? 'bg-amber-500/15' : ''
                    }`}
                  >
                    {/* Volume Bar Fill */}
                    <div
                      className={`absolute top-0 bottom-0 left-0 opacity-20 pointer-events-none transition-all ${
                        lvl.delta >= 0 ? 'bg-emerald-500' : 'bg-rose-500'
                      }`}
                      style={{ width: `${barPercent}%` }}
                    />

                    {/* Price with markers */}
                    <div className="relative z-10 flex items-center gap-1.5 tabular-nums">
                      <span className={`${isPOC ? 'text-amber-400 font-bold' : isVAH || isVAL ? 'text-sky-400 font-semibold' : 'text-slate-300'}`}>
                        {formatPrice(lvl.price, tickSize)}
                      </span>
                      {isPOC && <span className="text-[9px] px-1 py-0.2 bg-amber-500/25 text-amber-300 border border-amber-500/40 rounded font-bold">POC</span>}
                      {isVAH && <span className="text-[9px] px-1 py-0.2 bg-sky-500/25 text-sky-300 border border-sky-500/40 rounded">VAH</span>}
                      {isVAL && <span className="text-[9px] px-1 py-0.2 bg-sky-500/25 text-sky-300 border border-sky-500/40 rounded">VAL</span>}
                    </div>

                    {/* Volume and Delta */}
                    <div className="relative z-10 flex items-center gap-2.5 tabular-nums">
                      <span className="text-slate-300 font-medium">{formatVolume(lvl.volume)}</span>
                      <span className={`w-12 text-right font-semibold ${lvl.delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {lvl.delta >= 0 ? '+' : ''}
                        {formatVolume(lvl.delta)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : aggregatedTpo.prices.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500 font-sans text-xs gap-2 my-auto">
            <span className="font-semibold text-slate-400 text-[11px]">MARKET PROFILE UNAVAILABLE</span>
            <span className="text-[10px] text-slate-500 max-w-[200px]">
              No TPO bracket data available yet for this instrument session.
            </span>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.03]">
            {aggregatedTpo.prices.slice(0, 100).map((price) => {
              const letters = aggregatedTpo.buckets.get(price) || [];
              const isPOC = Math.abs(price - tpoProfile.poc) < (tickSize * 2 || 1);
              const isCurrent = Math.abs(price - currentPrice) < (tickSize ? tickSize * 2 : 0.5);

              return (
                <div
                  key={price}
                  className={`flex items-center px-2.5 py-1 hover:bg-white/5 transition-colors ${
                    isCurrent ? 'bg-sky-500/15' : ''
                  }`}
                >
                  <div className="w-16 shrink-0 flex items-center gap-1 tabular-nums">
                    <span className={isPOC ? 'text-amber-400 font-bold' : 'text-slate-300'}>
                      {formatPrice(price, tickSize)}
                    </span>
                    {isPOC && <span className="text-[8px] px-0.5 bg-amber-500/20 text-amber-400 rounded">POC</span>}
                  </div>

                  {/* TPO Letters */}
                  <div className="flex-1 flex flex-wrap gap-0.5 overflow-hidden">
                    {letters.map((char, idx) => (
                      <span
                        key={idx}
                        className={`px-0.5 rounded text-[9px] font-bold ${
                          isPOC
                            ? 'text-amber-300 bg-amber-500/15'
                            : char <= 'B'
                            ? 'text-purple-300 bg-purple-500/15' // Initial Balance (A, B)
                            : 'text-sky-300 bg-sky-500/10'
                        }`}
                      >
                        {char}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

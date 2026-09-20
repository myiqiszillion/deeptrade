import React, { useState } from 'react';
import { TPOProfileData, VolumeProfileData } from '../../types';
import { formatPrice } from '../../services/priceFormat';

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
  tickSize,
}) => {
  const [activeTab, setActiveTab] = useState<'VP' | 'TPO'>('VP');

  const maxVolume = Math.max(1, ...volumeProfile.levels.map((l) => l.volume));

  // Sort descending by price
  const sortedVpLevels = [...volumeProfile.levels].sort((a, b) => b.price - a.price);

  const sortedTpoPrices = Object.keys(tpoProfile.priceLevels)
    .map(Number)
    .sort((a, b) => b - a);

  return (
    <div className="w-80 h-full border-l border-brand-border bg-brand-surface flex flex-col select-none text-xs">
      {/* Header Tabs */}
      <div className="flex items-center justify-between border-b border-brand-border px-3 py-2 bg-brand-surfaceHover">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('VP')}
            className={`px-3 py-1 font-semibold rounded ${
              activeTab === 'VP' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' : 'text-slate-400 hover:text-white'
            }`}
          >
            Volume Profile
          </button>
          <button
            onClick={() => setActiveTab('TPO')}
            className={`px-3 py-1 font-semibold rounded ${
              activeTab === 'TPO' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40' : 'text-slate-400 hover:text-white'
            }`}
          >
            Market Profile (TPO)
          </button>
        </div>
      </div>

      {/* Profile Metrics Bar */}
      <div className="grid grid-cols-3 gap-1 px-3 py-2 bg-brand-bg/50 border-b border-brand-border text-slate-300 font-mono text-[11px]">
        <div>
          <span className="text-slate-500">VAH: </span>
          <span className="text-blue-400">{formatPrice(activeTab === 'VP' ? volumeProfile.vah : tpoProfile.vah, tickSize)}</span>
        </div>
        <div>
          <span className="text-slate-500">POC: </span>
          <span className="text-amber-400 font-bold">{formatPrice(activeTab === 'VP' ? volumeProfile.poc : tpoProfile.poc, tickSize)}</span>
        </div>
        <div>
          <span className="text-slate-500">VAL: </span>
          <span className="text-blue-400">{formatPrice(activeTab === 'VP' ? volumeProfile.val : tpoProfile.val, tickSize)}</span>
        </div>
      </div>

      {/* Main Profile View */}
      <div className="flex-1 overflow-y-auto font-mono text-[10px]">
        {activeTab === 'VP' ? (
          <div className="divide-y divide-brand-border/30">
            {sortedVpLevels.slice(0, 80).map((lvl) => {
              const isPOC = lvl.price === volumeProfile.poc;
              const isVAH = lvl.price === volumeProfile.vah;
              const isVAL = lvl.price === volumeProfile.val;
              const isCurrent = Math.abs(lvl.price - currentPrice) < (tickSize ? tickSize * 2 : 0.5);
              const barPercent = Math.min(100, (lvl.volume / maxVolume) * 100);

              return (
                <div
                  key={lvl.price}
                  className={`relative flex items-center justify-between px-2 py-0.5 hover:bg-white/5 ${
                    isCurrent ? 'bg-amber-500/10' : ''
                  }`}
                >
                  {/* Volume Bar Fill */}
                  <div
                    className={`absolute top-0 bottom-0 left-0 opacity-25 ${
                      lvl.delta >= 0 ? 'bg-emerald-500' : 'bg-rose-500'
                    }`}
                    style={{ width: `${barPercent}%` }}
                  />

                  {/* Price with markers */}
                  <div className="relative z-10 flex items-center gap-1">
                    <span className={`${isPOC ? 'text-amber-400 font-bold' : isVAH || isVAL ? 'text-blue-400' : 'text-slate-300'}`}>
                      {formatPrice(lvl.price, tickSize)}
                    </span>
                    {isPOC && <span className="text-[9px] px-1 bg-amber-500/20 text-amber-400 rounded">POC</span>}
                    {isVAH && <span className="text-[9px] px-1 bg-blue-500/20 text-blue-400 rounded">VAH</span>}
                    {isVAL && <span className="text-[9px] px-1 bg-blue-500/20 text-blue-400 rounded">VAL</span>}
                  </div>

                  {/* Volume and Delta */}
                  <div className="relative z-10 flex items-center gap-2">
                    <span className="text-slate-400">{lvl.volume.toFixed(1)}</span>
                    <span className={lvl.delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                      {lvl.delta >= 0 ? '+' : ''}
                      {lvl.delta.toFixed(1)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="divide-y divide-brand-border/30">
            {sortedTpoPrices.slice(0, 80).map((price) => {
              const letters = tpoProfile.priceLevels[price] || [];
              const isPOC = price === tpoProfile.poc;
              const isCurrent = Math.abs(price - currentPrice) < (tickSize ? tickSize * 2 : 0.5);

              return (
                <div
                  key={price}
                  className={`flex items-center px-2 py-0.5 hover:bg-white/5 ${
                    isCurrent ? 'bg-blue-500/10' : ''
                  }`}
                >
                  <div className="w-14 shrink-0 flex items-center gap-1">
                    <span className={isPOC ? 'text-amber-400 font-bold' : 'text-slate-300'}>
                      {formatPrice(price, tickSize)}
                    </span>
                  </div>

                  {/* TPO Letters */}
                  <div className="flex-1 flex flex-wrap gap-0.5 overflow-hidden">
                    {letters.map((char, idx) => (
                      <span
                        key={idx}
                        className={`px-0.5 rounded text-[9px] font-bold ${
                          isPOC
                            ? 'text-amber-400'
                            : char <= 'B'
                            ? 'text-purple-400' // Initial Balance (A, B)
                            : 'text-sky-300'
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

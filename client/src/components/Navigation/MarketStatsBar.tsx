import React from 'react';
import { VolumeProfileData, OrderbookSnapshot, FuturesInstrument } from '../../types';
import { formatPrice, formatVolume } from '../../services/priceFormat';

interface MarketStatsBarProps {
  currentPrice: number;
  currentCVD: number;
  volumeProfile: VolumeProfileData;
  orderbook: OrderbookSnapshot;
  instrument?: FuturesInstrument;
  highPrice?: number;
  lowPrice?: number;
  vwapPrice?: number;
}

export const MarketStatsBar: React.FC<MarketStatsBarProps> = ({
  currentPrice: _currentPrice,
  currentCVD,
  volumeProfile,
  orderbook,
  instrument,
  highPrice,
  lowPrice,
  vwapPrice,
}) => {
  const tickSize = instrument?.tickSize || 0.25;
  const bestBid = orderbook.bids[0]?.price;
  const bestAsk = orderbook.asks[0]?.price;
  const spread = bestBid && bestAsk ? Math.max(0, bestAsk - bestBid) : null;
  const spreadTicks = spread !== null && tickSize > 0 ? Math.round(spread / tickSize) : null;

  return (
    <div className="hidden lg:flex items-center gap-2 text-[11px] font-mono text-slate-400 select-none">
      {/* Session Delta / CVD pill */}
      <div
        className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-semibold tabular-nums ${
          currentCVD >= 0
            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
            : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
        }`}
        title="Session Cumulative Volume Delta"
      >
        <span className="text-[9px] uppercase tracking-wider font-sans font-bold text-slate-400">CVD</span>
        <span>{currentCVD >= 0 ? `+${formatVolume(currentCVD)}` : formatVolume(currentCVD)}</span>
      </div>

      {/* Spread Pill */}
      {spread !== null && spread > 0 && (
        <div
          className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-900/60 border border-slate-800 text-[10px]"
          title="Best Bid/Ask Spread"
        >
          <span className="text-slate-500 font-sans">Spread:</span>
          <span className="text-slate-200 font-semibold">{spread.toFixed(2)}</span>
          {spreadTicks !== null && (
            <span className="text-slate-500 text-[9px]">({spreadTicks}T)</span>
          )}
        </div>
      )}

      {/* VWAP */}
      {vwapPrice && vwapPrice > 0 ? (
        <div
          className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/5 border border-amber-500/20 text-[10px]"
          title="Anchored Volume Weighted Average Price"
        >
          <span className="text-amber-400/80 font-sans font-semibold">VWAP:</span>
          <span className="text-amber-300 font-bold tabular-nums">
            {formatPrice(vwapPrice, tickSize)}
          </span>
        </div>
      ) : null}

      {/* Volume Profile POC */}
      {volumeProfile.poc > 0 && (
        <div
          className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-900/60 border border-slate-800 text-[10px]"
          title="Session Point of Control (POC)"
        >
          <span className="text-amber-400/80 font-sans font-semibold">POC:</span>
          <span className="text-slate-200 font-bold tabular-nums">
            {formatPrice(volumeProfile.poc, tickSize)}
          </span>
        </div>
      )}

      {/* Session High / Low */}
      {highPrice && lowPrice && highPrice > lowPrice ? (
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-900/40 border border-slate-800/80 text-[10px]">
          <span className="text-emerald-400 font-bold">H: {formatPrice(highPrice, tickSize)}</span>
          <span className="text-slate-600">/</span>
          <span className="text-rose-400 font-bold">L: {formatPrice(lowPrice, tickSize)}</span>
        </div>
      ) : null}
    </div>
  );
};

import React, { useRef, useEffect } from 'react';
import { OrderbookSnapshot } from '../../types';
import { formatPrice, formatVolume } from '../../services/priceFormat';

interface DOMLadderProps {
  orderbook: OrderbookSnapshot;
  currentPrice: number;
  symbol: string;
  isFutures: boolean;
  tickSize?: number;
}

export const DOMLadder: React.FC<DOMLadderProps> = ({
  orderbook,
  currentPrice,
  symbol,
  tickSize = 0.5,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const spreadRef = useRef<HTMLDivElement | null>(null);

  const isDepthActive = orderbook.bids.length + orderbook.asks.length > 0;
  const asks = [...orderbook.asks].reverse(); // Asks sorted high to low down to best ask
  const bids = [...orderbook.bids]; // Bids sorted highest first

  const maxBookSize = Math.max(
    1,
    ...bids.map((b) => b.size),
    ...asks.map((a) => a.size)
  );

  const totalBidDepth = bids.reduce((acc, b) => acc + b.size, 0);
  const totalAskDepth = asks.reduce((acc, a) => acc + a.size, 0);

  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[asks.length - 1]?.price ?? null;
  const spread = isDepthActive && bestBid !== null && bestAsk !== null ? Math.max(0, bestAsk - bestBid) : null;

  const scrollToCenter = () => {
    if (spreadRef.current && containerRef.current) {
      spreadRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  };

  useEffect(() => {
    if (spreadRef.current && containerRef.current) {
      spreadRef.current.scrollIntoView({ block: 'center' });
    }
  }, [symbol]);

  return (
    <div className="w-full h-full flex flex-col select-none font-mono text-xs bg-slate-950/40">
      {/* Sub-header status strip */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5 bg-slate-900/50 text-[10px]">
        <div className="flex items-center gap-1.5 text-slate-400 font-sans font-medium">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isDepthActive
                ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]'
                : 'bg-slate-500'
            }`}
          />
          <span>{isDepthActive ? 'Realtime Depth L2' : 'Feed: Unavailable'}</span>
        </div>
        <div className="flex items-center gap-2">
          {isDepthActive && (
            <button
              onClick={scrollToCenter}
              className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[9px] font-sans font-semibold transition-colors"
              title="Center DOM on active price"
            >
              Center
            </button>
          )}
          <span
            className={`px-1.5 py-0.5 rounded font-semibold text-[9px] tracking-wide ${
              isDepthActive
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                : 'bg-slate-800 text-slate-400 border border-slate-700'
            }`}
          >
            {isDepthActive ? 'L2 ACTIVE' : 'FEED: UNAVAILABLE'}
          </span>
        </div>
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-3 text-center py-1.5 border-b border-white/5 bg-slate-900/80 text-[10px] text-slate-400 font-semibold tracking-wider">
        <div className="text-emerald-400/90 text-left pl-3">BID SIZE</div>
        <div>PRICE</div>
        <div className="text-rose-400/90 text-right pr-3">ASK SIZE</div>
      </div>

      {/* DOM Rows */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto divide-y divide-white/[0.03] text-[11px] custom-scrollbar flex flex-col"
      >
        {!isDepthActive || bids.length + asks.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500 font-sans text-xs gap-2.5 my-auto">
            <div className="w-9 h-9 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500">
              <span className="w-2 h-2 rounded-full bg-slate-600" />
            </div>
            <div className="font-semibold text-slate-400 tracking-wide text-[11px]">FEED: UNAVAILABLE</div>
            <div className="text-[10px] text-slate-500 max-w-[210px] leading-relaxed">
              No live orderbook depth records available for <strong className="text-slate-400 font-normal">{symbol}</strong>. Actual DOM levels will populate when depth stream connects.
            </div>
          </div>
        ) : (
          <>
            {/* Asks (Red side) */}
            {asks.slice(-25).map((ask) => {
          const depthPercent = (ask.size / maxBookSize) * 100;
          const ps = ask.pullingStacking || 0;

          return (
            <div
              key={ask.price}
              className="grid grid-cols-3 text-center py-1 hover:bg-rose-500/10 relative transition-colors duration-75"
            >
              {/* Left blank for asks */}
              <div />

              {/* Price */}
              <div className="text-rose-400 font-bold z-10 tabular-nums">
                {formatPrice(ask.price, tickSize)}
              </div>

              {/* Ask Size & Pulling/Stacking */}
              <div className="relative flex items-center justify-end px-3 z-10 gap-1.5 tabular-nums">
                {ps !== 0 && (
                  <span
                    className={`text-[9px] px-1 rounded font-semibold ${
                      ps > 0 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                    }`}
                  >
                    {ps > 0 ? `+${formatVolume(ps)}` : formatVolume(ps)}
                  </span>
                )}
                <span className={isDepthActive ? 'text-slate-200 font-medium' : 'text-slate-600 font-mono text-[10px]'}>
                  {isDepthActive ? formatVolume(ask.size) : '—'}
                </span>
              </div>

              {/* Depth bar fill (Smooth gradient right to left) */}
              <div
                className="absolute top-0 bottom-0 right-0 bg-gradient-to-l from-rose-500/25 via-rose-500/10 to-transparent pointer-events-none"
                style={{ width: `${depthPercent * 0.45}%` }}
              />
            </div>
          );
        })}

        {/* Current Spread Bar */}
        <div
          ref={spreadRef}
          className="py-1 px-3 bg-gradient-to-r from-amber-500/15 via-amber-500/20 to-amber-500/15 text-center text-amber-300 font-bold border-y border-amber-500/30 text-xs flex items-center justify-between shadow-[0_0_12px_rgba(245,158,11,0.15)] my-0.5"
        >
          <span className="text-[10px] font-mono font-normal text-amber-400/90">
            {spread !== null ? `SPR: ${formatPrice(spread, tickSize)}` : isDepthActive ? 'SPR: —' : 'STANDBY'}
          </span>
          <span className="text-[11px] font-mono tracking-tight text-white flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${isDepthActive ? 'bg-amber-400 animate-pulse' : 'bg-amber-400'}`} />
            {currentPrice > 0 ? formatPrice(currentPrice, tickSize) : '—'}
          </span>
          <span className="text-[10px] font-mono font-normal text-amber-400/80">
            {isDepthActive ? `${bids.length + asks.length} LVLS` : 'PRICE REF'}
          </span>
        </div>

        {/* Bids (Green side) */}
        {bids.slice(0, 25).map((bid) => {
          const depthPercent = isDepthActive ? (bid.size / maxBookSize) * 100 : 0;
          const ps = bid.pullingStacking || 0;

          return (
            <div
              key={bid.price}
              className="grid grid-cols-3 text-center py-1 hover:bg-emerald-500/10 relative transition-colors duration-75"
            >
              {/* Bid Size & Pulling/Stacking */}
              <div className="relative flex items-center justify-start px-3 z-10 gap-1.5 tabular-nums">
                <span className={isDepthActive ? 'text-slate-200 font-medium' : 'text-slate-600 font-mono text-[10px]'}>
                  {isDepthActive ? formatVolume(bid.size) : '—'}
                </span>
                {ps !== 0 && (
                  <span
                    className={`text-[9px] px-1 rounded font-semibold ${
                      ps > 0 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                    }`}
                  >
                    {ps > 0 ? `+${formatVolume(ps)}` : formatVolume(ps)}
                  </span>
                )}
              </div>

              {/* Price */}
              <div className="text-emerald-400 font-bold z-10 tabular-nums">
                {formatPrice(bid.price, tickSize)}
              </div>

              {/* Right blank for bids */}
              <div />

              {/* Depth bar fill (Smooth gradient left to right) */}
              <div
                className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-emerald-500/25 via-emerald-500/10 to-transparent pointer-events-none"
                style={{ width: `${depthPercent * 0.45}%` }}
              />
            </div>
          );
        })}
          </>
        )}
      </div>

      {/* Depth Totals Footer */}
      {isDepthActive && (
        <div className="flex items-center justify-between px-3 py-1.5 border-t border-white/5 bg-slate-900/60 text-[10px] text-slate-400 font-mono">
          <span className="text-emerald-400 font-medium">Bids: {formatVolume(totalBidDepth)}</span>
          <span className="text-slate-500">|</span>
          <span className="text-rose-400 font-medium">Asks: {formatVolume(totalAskDepth)}</span>
        </div>
      )}
    </div>
  );
};

export const DOMScalper = DOMLadder;

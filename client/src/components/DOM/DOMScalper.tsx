import React from 'react';
import { OrderbookSnapshot } from '../../types';
import { formatPrice } from '../../services/priceFormat';

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
  tickSize,
}) => {
  // Build unified DOM ladder
  const asks = [...orderbook.asks].reverse(); // Asks sorted high to low down to best ask
  const bids = [...orderbook.bids]; // Bids sorted highest first

  const maxBookSize = Math.max(
    1,
    ...orderbook.bids.map((b) => b.size),
    ...orderbook.asks.map((a) => a.size)
  );

  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[asks.length - 1]?.price ?? null;
  const spread = bestBid !== null && bestAsk !== null ? Math.max(0, bestAsk - bestBid) : null;

  return (
    <div className="w-80 h-full border-l border-brand-border bg-brand-surface flex flex-col select-none font-mono text-xs">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-brand-border px-3 py-2 bg-brand-surfaceHover">
        <span className="font-bold text-slate-200">DOM LADDER (VIEW ONLY)</span>
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
            orderbook.bids.length + orderbook.asks.length > 0
              ? 'bg-emerald-500/20 text-emerald-400'
              : 'bg-amber-500/20 text-amber-400'
          }`}
          title="Depth snapshot; connection status is shown in the workspace footer"
        >
          {orderbook.bids.length + orderbook.asks.length > 0 ? 'DEPTH SNAPSHOT' : 'NO DEPTH'}
        </span>
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-3 text-center py-1.5 border-b border-brand-border bg-brand-surfaceHover text-[10px] text-slate-400 font-semibold">
        <div>BID SIZE (P&S)</div>
        <div>PRICE</div>
        <div>ASK SIZE (P&S)</div>
      </div>

      {/* DOM Rows */}
      <div className="flex-1 overflow-y-auto divide-y divide-brand-border/20 text-[11px]">
        {bids.length + asks.length === 0 && <div className="p-6 text-center text-slate-500">No depth data for {symbol}. Waiting for a valid order book.</div>}
        {/* Asks (Red side) */}
        {asks.slice(-20).map((ask) => {
          const depthPercent = (ask.size / maxBookSize) * 100;
          const ps = ask.pullingStacking || 0;

          return (
            <div
              key={ask.price}
              className="grid grid-cols-3 text-center py-0.5 hover:bg-rose-500/10 relative"
            >
              {/* Left blank */}
              <div />

              {/* Price */}
              <div className="text-rose-400 font-bold z-10">{formatPrice(ask.price, tickSize)}</div>

              {/* Ask Size & Pulling/Stacking */}
              <div className="relative flex items-center justify-end px-2 z-10 gap-1.5">
                {ps !== 0 && (
                  <span className={`text-[9px] ${ps > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {ps > 0 ? `+${ps.toFixed(1)}` : ps.toFixed(1)}
                  </span>
                )}
                <span className="text-slate-200">{ask.size.toFixed(2)}</span>
              </div>

              {/* Depth bar fill */}
              <div
                className="absolute top-0 bottom-0 right-0 bg-rose-500/15"
                style={{ width: `${depthPercent * 0.33}%` }}
              />
            </div>
          );
        })}

        {/* Current Spread Bar */}
        <div className="py-1 px-3 bg-amber-500/15 text-center text-amber-400 font-bold border-y border-amber-500/30 text-xs flex items-center justify-between">
          <span className="text-[10px] font-normal text-amber-400/80">
            {spread !== null ? `SPREAD: ${formatPrice(spread, tickSize)}` : 'SPREAD: —'}
          </span>
          <span>CURRENT: {currentPrice > 0 ? formatPrice(currentPrice, tickSize) : '—'}</span>
          <span className="text-[10px] font-normal text-amber-400/80">
            {bids.length + asks.length} LVLS
          </span>
        </div>

        {/* Bids (Green side) */}
        {bids.slice(0, 20).map((bid) => {
          const depthPercent = (bid.size / maxBookSize) * 100;
          const ps = bid.pullingStacking || 0;

          return (
            <div
              key={bid.price}
              className="grid grid-cols-3 text-center py-0.5 hover:bg-emerald-500/10 relative"
            >
              {/* Bid Size & Pulling/Stacking */}
              <div className="relative flex items-center justify-start px-2 z-10 gap-1.5">
                <span className="text-slate-200">{bid.size.toFixed(2)}</span>
                {ps !== 0 && (
                  <span className={`text-[9px] ${ps > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {ps > 0 ? `+${ps.toFixed(1)}` : ps.toFixed(1)}
                  </span>
                )}
              </div>

              {/* Price */}
              <div className="text-emerald-400 font-bold z-10">{formatPrice(bid.price, tickSize)}</div>

              {/* Right blank */}
              <div />

              {/* Depth bar fill */}
              <div
                className="absolute top-0 bottom-0 left-0 bg-emerald-500/15"
                style={{ width: `${depthPercent * 0.33}%` }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const DOMScalper = DOMLadder;

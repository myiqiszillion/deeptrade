import React, { useState, useEffect } from 'react';
import { OrderbookSnapshot, RestingOrder } from '../../types';
import { wsClient } from '../../services/websocket';
import { X, Lock } from 'lucide-react';

interface DOMScalperProps {
  orderbook: OrderbookSnapshot;
  currentPrice: number;
  symbol: string;
  openOrders: RestingOrder[];
  isLockedOut: boolean;
  onCancelOrder: (orderId: string) => void;
}

export const DOMScalper: React.FC<DOMScalperProps> = ({
  orderbook,
  currentPrice,
  symbol,
  openOrders,
  isLockedOut,
  onCancelOrder,
}) => {
  const [orderSize, setOrderSize] = useState<number>(0.5);

  // Keyboard Hotkeys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in input
      if ((e.target as HTMLElement).tagName === 'INPUT') return;

      if (e.key === 'a' || e.key === 'A') {
        handleBuyMarket();
      } else if (e.key === 's' || e.key === 'S') {
        handleSellMarket();
      } else if (e.key === 'd' || e.key === 'D') {
        handleFlatten();
      } else if (e.key === 'w' || e.key === 'W') {
        handleReverse();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [orderSize, isLockedOut]);

  const handleBuyMarket = () => {
    if (isLockedOut) return;
    wsClient.placeOrder('BUY', orderSize, undefined, 'MARKET');
  };

  const handleSellMarket = () => {
    if (isLockedOut) return;
    wsClient.placeOrder('SELL', orderSize, undefined, 'MARKET');
  };

  const handleFlatten = () => {
    wsClient.placeOrder('FLATTEN', orderSize);
  };

  const handleReverse = () => {
    if (isLockedOut) return;
    wsClient.placeOrder('FLATTEN', orderSize);
    setTimeout(() => {
      wsClient.placeOrder('SELL', orderSize);
    }, 50);
  };

  const handlePriceClick = (price: number, side: 'BUY' | 'SELL') => {
    wsClient.placeOrder(side, orderSize, price, 'LIMIT');
  };

  // Build unified DOM ladder
  const asks = [...orderbook.asks].reverse(); // Asks sorted high to low down to best ask
  const bids = [...orderbook.bids]; // Bids sorted highest first

  const maxBookSize = Math.max(
    1,
    ...orderbook.bids.map((b) => b.size),
    ...orderbook.asks.map((a) => a.size)
  );

  return (
    <div className="w-80 h-full border-l border-brand-border bg-brand-surface flex flex-col select-none font-mono text-xs">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-brand-border px-3 py-2 bg-brand-surfaceHover">
        <span className="font-bold text-slate-200">ADVANCED DOM LADDER</span>
        {isLockedOut ? (
          <span className="text-[10px] px-1.5 py-0.5 bg-rose-500/20 text-rose-400 rounded font-bold flex items-center gap-1">
            <Lock size={10} /> LOCKED OUT
          </span>
        ) : (
          <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded">Real L2 Feed</span>
        )}
      </div>

      {/* Scalper Action Buttons */}
      <div className="p-2 border-b border-brand-border bg-brand-bg/40 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={handleBuyMarket}
            disabled={isLockedOut}
            className="py-2 px-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded shadow flex flex-col items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span>BUY MKT [A]</span>
            <span className="text-[10px] font-normal opacity-80">{orderSize} {symbol}</span>
          </button>
          <button
            onClick={handleSellMarket}
            disabled={isLockedOut}
            className="py-2 px-3 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded shadow flex flex-col items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span>SELL MKT [S]</span>
            <span className="text-[10px] font-normal opacity-80">{orderSize} {symbol}</span>
          </button>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          <button
            onClick={handleFlatten}
            className="py-1 px-2 bg-amber-600/30 hover:bg-amber-600/50 text-amber-300 font-semibold rounded border border-amber-500/30 text-[11px]"
          >
            FLATTEN [D]
          </button>
          <button
            onClick={handleReverse}
            disabled={isLockedOut}
            className="py-1 px-2 bg-purple-600/30 hover:bg-purple-600/50 text-purple-300 font-semibold rounded border border-purple-500/30 text-[11px] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            REVERSE [W]
          </button>
          <button
            onClick={() => wsClient.cancelOrder()}
            className="py-1 px-2 bg-slate-700/50 hover:bg-slate-700 text-slate-300 font-semibold rounded text-[11px]"
          >
            CANCEL ALL
          </button>
        </div>

        {/* Size Selection */}
        <div className="flex items-center justify-between pt-1">
          <span className="text-slate-400 text-[11px]">Size:</span>
          <div className="flex gap-1">
            {[0.1, 0.5, 1.0, 2.0, 5.0].map((s) => (
              <button
                key={s}
                onClick={() => setOrderSize(s)}
                className={`px-2 py-0.5 rounded text-[10px] ${
                  orderSize === s ? 'bg-amber-500 text-black font-bold' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Working Orders (resting LIMIT queue) */}
      <div className="border-b border-brand-border bg-brand-bg/30">
        <div className="flex items-center justify-between px-3 py-1 text-[10px] font-bold text-slate-400">
          <span>WORKING ORDERS ({openOrders.length})</span>
          {openOrders.length > 0 && (
            <button onClick={() => wsClient.cancelOrder()} className="text-rose-400 hover:text-rose-300 font-semibold">
              CANCEL ALL
            </button>
          )}
        </div>
        {openOrders.length === 0 ? (
          <div className="px-3 pb-2 text-[10px] text-slate-600">
            {isLockedOut ? 'Trading halted — orders cleared by prop risk rules.' : 'Click a ladder price to rest a LIMIT order.'}
          </div>
        ) : (
          <div className="max-h-24 overflow-y-auto divide-y divide-brand-border/30">
            {openOrders.map((o) => (
              <div key={o.id} className="flex items-center justify-between px-3 py-1 text-[10px]">
                <span className={o.side === 'LONG' ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                  {o.side === 'LONG' ? 'BUY' : 'SELL'}
                </span>
                <span className="text-slate-200">{o.price.toFixed(1)}</span>
                <span className="text-slate-400">×{o.size}</span>
                <button
                  onClick={() => onCancelOrder(o.id)}
                  title="Cancel this order"
                  className="text-slate-500 hover:text-rose-400"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-3 text-center py-1 border-b border-brand-border bg-brand-surfaceHover text-[10px] text-slate-400 font-semibold">
        <div>BID SIZE (P&S)</div>
        <div>PRICE</div>
        <div>ASK SIZE (P&S)</div>
      </div>

      {/* DOM Rows */}
      <div className="flex-1 overflow-y-auto divide-y divide-brand-border/20 text-[11px]">
        {/* Asks (Red side) */}
        {asks.slice(-20).map((ask) => {
          const depthPercent = (ask.size / maxBookSize) * 100;
          const ps = ask.pullingStacking || 0;

          return (
            <div
              key={ask.price}
              onClick={() => handlePriceClick(ask.price, 'SELL')}
              className="grid grid-cols-3 text-center py-0.5 hover:bg-rose-500/10 cursor-pointer relative"
            >
              {/* Left blank */}
              <div />

              {/* Price */}
              <div className="text-rose-400 font-bold z-10">{ask.price.toFixed(1)}</div>

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
        <div className="py-1 px-3 bg-amber-500/15 text-center text-amber-400 font-bold border-y border-amber-500/30 text-xs">
          CURRENT: {currentPrice.toFixed(1)}
        </div>

        {/* Bids (Green side) */}
        {bids.slice(0, 20).map((bid) => {
          const depthPercent = (bid.size / maxBookSize) * 100;
          const ps = bid.pullingStacking || 0;

          return (
            <div
              key={bid.price}
              onClick={() => handlePriceClick(bid.price, 'BUY')}
              className="grid grid-cols-3 text-center py-0.5 hover:bg-emerald-500/10 cursor-pointer relative"
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
              <div className="text-emerald-400 font-bold z-10">{bid.price.toFixed(1)}</div>

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

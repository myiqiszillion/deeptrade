import React, { useMemo } from 'react';
import { Layers, Shield, TrendingDown, TrendingUp, Zap } from 'lucide-react';
import { OrderbookSnapshot } from '../../types';

interface LiquidityMatrixProps {
  orderbook: OrderbookSnapshot;
  currentPrice: number;
  tickSize?: number;
}

export const LiquidityMatrix: React.FC<LiquidityMatrixProps> = ({
  orderbook,
  currentPrice,
  tickSize = 0.25,
}) => {
  const bids = orderbook?.bids?.slice(0, 10) ?? [];
  const asks = orderbook?.asks?.slice(0, 10) ?? [];

  // Calculate cumulative sizes and max size for relative bar widths
  const { maxBidSize, maxAskSize, totalBidDepth, totalAskDepth, highestWall } = useMemo(() => {
    let maxB = 1;
    let maxA = 1;
    let sumB = 0;
    let sumA = 0;
    let wall = { price: 0, size: 0, side: 'bid' as 'bid' | 'ask' };

    bids.forEach((b) => {
      sumB += b.size;
      if (b.size > maxB) maxB = b.size;
      if (b.size > wall.size) wall = { price: b.price, size: b.size, side: 'bid' };
    });

    asks.forEach((a) => {
      sumA += a.size;
      if (a.size > maxA) maxA = a.size;
      if (a.size > wall.size) wall = { price: a.price, size: a.size, side: 'ask' };
    });

    return {
      maxBidSize: Math.max(maxB, 1),
      maxAskSize: Math.max(maxA, 1),
      totalBidDepth: sumB,
      totalAskDepth: sumA,
      highestWall: wall,
    };
  }, [bids, asks]);

  // Overall book skew percentage
  const totalVolume = totalBidDepth + totalAskDepth || 1;
  const bidSkewPct = Math.round((totalBidDepth / totalVolume) * 100);
  const askSkewPct = 100 - bidSkewPct;

  // Best bid and ask spread
  const bestBid = bids[0]?.price ?? currentPrice;
  const bestAsk = asks[0]?.price ?? currentPrice;
  const spread = Math.max(0, +(bestAsk - bestBid).toFixed(4));
  const spreadTicks = (spread / tickSize).toFixed(1);

  return (
    <div className="cyber-panel cyber-corner-brackets p-3 flex flex-col h-full select-none font-mono">
      {/* Panel Header */}
      <div className="flex items-center justify-between border-b border-[#00f2fe]/20 pb-2 mb-2">
        <div className="flex items-center gap-2">
          <Layers size={14} className="text-[#00f2fe]" />
          <span className="text-xs font-bold text-[#E7EDF3] tracking-wider uppercase">
            Liquidity Depth Matrix
          </span>
          <span className="cyber-badge px-1.5 py-0.5 rounded">L2 DEPTH</span>
        </div>

        {/* Spread badge */}
        <div className="flex items-center gap-1.5 text-[10px] bg-[#06090e] px-2 py-0.5 rounded border border-[#1C2630]">
          <span className="text-[#7F8B97]">SPREAD:</span>
          <span className="text-[#00f2fe] font-bold">{spread > 0 ? spread.toFixed(2) : '0.25'}</span>
          <span className="text-[#4E5965]">({spreadTicks}T)</span>
        </div>
      </div>

      {/* Cumulative Ratio Bar */}
      <div className="mb-2 bg-[#06090e] p-2 rounded border border-[#1C2630]">
        <div className="flex justify-between text-[10px] mb-1">
          <span className="text-[#10b981] flex items-center gap-1">
            <TrendingUp size={11} /> BIDS: {totalBidDepth.toLocaleString()} ({bidSkewPct}%)
          </span>
          <span className="text-[#f43f5e] flex items-center gap-1">
            ASKS: {totalAskDepth.toLocaleString()} ({askSkewPct}%) <TrendingDown size={11} />
          </span>
        </div>
        <div className="h-1.5 w-full bg-[#111720] rounded-full overflow-hidden flex">
          <div
            className="h-full bg-gradient-to-r from-[#10b981]/50 to-[#10b981] transition-all duration-300"
            style={{ width: `${bidSkewPct}%` }}
          />
          <div
            className="h-full bg-gradient-to-r from-[#f43f5e] to-[#f43f5e]/50 transition-all duration-300"
            style={{ width: `${askSkewPct}%` }}
          />
        </div>
      </div>

      {/* Liquidity Wall Callout if detected */}
      {highestWall.size > 80 && (
        <div className="mb-2 px-2.5 py-1 rounded bg-[#00f2fe]/10 border border-[#00f2fe]/30 flex items-center justify-between text-[10px]">
          <span className="text-[#00f2fe] flex items-center gap-1.5 font-bold">
            <Shield size={12} className="text-[#00f2fe] animate-pulse" />
            LIQUIDITY WALL DETECTED
          </span>
          <span className={highestWall.side === 'bid' ? 'text-[#10b981]' : 'text-[#f43f5e]'}>
            {highestWall.size} lots @ {highestWall.price.toFixed(2)}
          </span>
        </div>
      )}

      {/* Main Dual Orderbook Matrix Table */}
      <div className="flex-1 flex gap-2 min-h-0 overflow-y-auto pr-1 text-[11px]">
        {/* BIDS Column */}
        <div className="flex-1 flex flex-col">
          <div className="flex justify-between text-[9px] text-[#7F8B97] border-b border-[#1C2630] pb-1 mb-1">
            <span>SIZE</span>
            <span>BID PRICE</span>
          </div>
          <div className="space-y-1">
            {bids.map((b, i) => {
              const widthPct = Math.min(100, Math.round((b.size / maxBidSize) * 100));
              const isWall = b.size >= 80;
              return (
                <div
                  key={`bid-${b.price}-${i}`}
                  className={`relative flex items-center justify-between px-1.5 py-0.5 rounded overflow-hidden text-xs ${
                    isWall ? 'border border-[#10b981]/50 bg-[#10b981]/10' : 'bg-[#0B1017]/80'
                  }`}
                >
                  {/* Dynamic background fill bar */}
                  <div
                    className="absolute top-0 right-0 bottom-0 bg-[#10b981]/15 transition-all duration-200"
                    style={{ width: `${widthPct}%` }}
                  />
                  <span className="relative z-10 font-bold text-[#E7EDF3] tabular-nums">
                    {b.size}
                  </span>
                  <span className="relative z-10 text-[#10b981] font-semibold tabular-nums">
                    {b.price.toFixed(2)}
                  </span>
                </div>
              );
            })}
            {bids.length === 0 && (
              <div className="text-[10px] text-[#4E5965] py-2 text-center">Awaiting Bid Stream...</div>
            )}
          </div>
        </div>

        {/* ASKS Column */}
        <div className="flex-1 flex flex-col">
          <div className="flex justify-between text-[9px] text-[#7F8B97] border-b border-[#1C2630] pb-1 mb-1">
            <span>ASK PRICE</span>
            <span>SIZE</span>
          </div>
          <div className="space-y-1">
            {asks.map((a, i) => {
              const widthPct = Math.min(100, Math.round((a.size / maxAskSize) * 100));
              const isWall = a.size >= 80;
              return (
                <div
                  key={`ask-${a.price}-${i}`}
                  className={`relative flex items-center justify-between px-1.5 py-0.5 rounded overflow-hidden text-xs ${
                    isWall ? 'border border-[#f43f5e]/50 bg-[#f43f5e]/10' : 'bg-[#0B1017]/80'
                  }`}
                >
                  {/* Dynamic background fill bar */}
                  <div
                    className="absolute top-0 left-0 bottom-0 bg-[#f43f5e]/15 transition-all duration-200"
                    style={{ width: `${widthPct}%` }}
                  />
                  <span className="relative z-10 text-[#f43f5e] font-semibold tabular-nums">
                    {a.price.toFixed(2)}
                  </span>
                  <span className="relative z-10 font-bold text-[#E7EDF3] tabular-nums">
                    {a.size}
                  </span>
                </div>
              );
            })}
            {asks.length === 0 && (
              <div className="text-[10px] text-[#4E5965] py-2 text-center">Awaiting Ask Stream...</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

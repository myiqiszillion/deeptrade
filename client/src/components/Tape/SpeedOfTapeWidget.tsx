import React from 'react';
import { DeepTrade, SpeedOfTapeData, Tick } from '../../types';
import { formatPrice } from '../../services/priceFormat';

interface SpeedOfTapeWidgetProps {
  tape: SpeedOfTapeData;
  recentTicks: Tick[];
  deepTrades: DeepTrade[];
  symbol: string;
  deepTradeThresholdUsd?: number;
  tickSize?: number;
}

export const SpeedOfTapeWidget: React.FC<SpeedOfTapeWidgetProps> = ({
  tape,
  recentTicks,
  deepTrades,
  symbol,
  deepTradeThresholdUsd,
  tickSize,
}) => {
  const thresholdLabel = deepTradeThresholdUsd
    ? deepTradeThresholdUsd >= 1_000_000
      ? `≥ $${(deepTradeThresholdUsd / 1_000_000).toFixed(1)}M`
      : `≥ $${Math.round(deepTradeThresholdUsd / 1000)}K`
    : '≥ 10 lots';
  return (
    <div className="w-72 h-full border-l border-brand-border bg-brand-surface flex flex-col select-none font-mono text-xs">
      {/* Header */}
      <div className="border-b border-brand-border px-3 py-2 bg-brand-surfaceHover flex items-center justify-between">
        <span className="font-bold text-slate-200">SPEED OF TAPE</span>
        <span className="text-[10px] text-slate-400">Time & Sales</span>
      </div>

      {/* Speed Metrics */}
      <div className="p-3 border-b border-brand-border bg-brand-bg/40 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Tape Speed:</span>
          <div className="flex items-center gap-1 font-bold text-sm">
            <span className={tape.tps > 20 ? 'text-amber-400' : 'text-slate-200'}>
              {tape.tps.toFixed(1)}
            </span>
            <span className="text-[10px] font-normal text-slate-500">TPS</span>
            {tape.acceleration > 0.1 && <span className="text-emerald-400 text-xs">▲</span>}
            {tape.acceleration < -0.1 && <span className="text-rose-400 text-xs">▼</span>}
          </div>
        </div>

        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-400">Volume / Sec:</span>
          <span className="text-slate-200 font-semibold">{tape.volumePerSec.toFixed(2)} {symbol}</span>
        </div>

        {/* Buy Pressure Ratio */}
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-slate-400">
            <span className="text-emerald-400">{(tape.buyRatio * 100).toFixed(0)}% Buy</span>
            <span className="text-rose-400">{((1 - tape.buyRatio) * 100).toFixed(0)}% Sell</span>
          </div>
          <div className="w-full h-1.5 bg-rose-500 rounded-full overflow-hidden flex">
            <div
              className="bg-emerald-500 h-full transition-all duration-300"
              style={{ width: `${tape.buyRatio * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Deep Trades (Whale Tracker) Section */}
      {deepTrades.length > 0 && (
        <div className="border-b border-brand-border p-2 bg-purple-950/20">
          <div className="flex items-center justify-between text-[10px] text-purple-400 font-bold mb-1">
            <span>WHALE / DEEP TRADES</span>
            <span className="text-slate-400 font-normal">{thresholdLabel}</span>
          </div>
          <div className="space-y-1 max-h-24 overflow-y-auto">
            {deepTrades.slice(0, 3).map((dt) => (
              <div
                key={dt.id}
                className="flex items-center justify-between p-1 bg-purple-900/30 rounded border border-purple-500/20 text-[10px]"
              >
                <span className={dt.side === 'buy' ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                  {dt.side.toUpperCase()}
                </span>
                <span className="text-slate-200">{formatPrice(dt.price, tickSize)}</span>
                <span className="text-purple-300 font-bold">${(dt.valueUsd / 1000).toFixed(1)}K</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Time & Sales Ticker Stream */}
      <div className="flex-1 overflow-y-auto divide-y divide-brand-border/10 text-[10px]">
        {recentTicks.slice(0, 50).map((tick) => {
          const isBuy = !tick.isBuyerMaker;
          const timeStr = new Date(tick.timestamp).toTimeString().split(' ')[0] + '.' + String(tick.timestamp % 1000).padStart(3, '0');

          return (
            <div
              key={tick.id}
              className={`flex items-center justify-between px-3 py-0.5 hover:bg-white/5 ${
                tick.price * tick.size > 50000 ? 'bg-purple-900/30 font-bold' : ''
              }`}
            >
              <span className="text-slate-500">{timeStr}</span>
              <span className={isBuy ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
                {formatPrice(tick.price, tickSize)}
              </span>
              <span className="text-slate-300">{tick.size.toFixed(3)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

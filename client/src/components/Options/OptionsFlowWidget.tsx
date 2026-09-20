import React from 'react';
import { OptionsFlowTrade } from '../../types';
import { Flame } from 'lucide-react';

interface OptionsFlowWidgetProps {
  flowTrades: OptionsFlowTrade[];
}

export const OptionsFlowWidget: React.FC<OptionsFlowWidgetProps> = ({ flowTrades }) => {
  return (
    <div className="w-80 h-full border-l border-brand-border bg-brand-surface flex flex-col select-none font-mono text-xs">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-brand-border px-3 py-2 bg-brand-surfaceHover">
        <div className="flex items-center gap-1.5 font-bold text-slate-200">
          <Flame size={14} className="text-rose-400" />
          <span>OPTIONS FLOW SCANNER</span>
          <span
            className="text-[9px] px-1 py-0.5 rounded bg-amber-500/15 text-amber-300 font-normal border border-amber-500/40"
            title="No real options-flow provider is configured"
          >
            UNAVAILABLE
          </span>
        </div>
        <span className="text-[10px] px-1.5 py-0.5 bg-rose-500/20 text-rose-300 rounded font-bold">
          Whale Sweeps &gt; $100K
        </span>
      </div>

      {/* Flow Stream */}
      <div className="flex-1 overflow-y-auto divide-y divide-brand-border/20 text-[10px]">
        {flowTrades.length === 0 ? (
          <div className="p-4 text-center space-y-1">
            <div className="font-bold text-amber-400">OPTIONS FLOW: UNAVAILABLE</div>
            <div className="text-slate-400">
              No real options-flow provider is configured, and DeepChart does not fabricate sweeps or blocks.
            </div>
            <div className="text-[10px] text-slate-500">
              Wire a licensed provider (CBOE-derived or a commercial flow feed) to populate this scanner.
            </div>
          </div>
        ) : (
          flowTrades.map((trade) => {
            const isBullish = trade.sentiment === 'BULLISH';
            const is0Dte = trade.dte === 0;

            return (
              <div key={trade.id} className="p-2.5 hover:bg-white/5 space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-slate-200">{trade.underlying}</span>
                    <span
                      className={`px-1 py-0.2 rounded font-bold ${
                        trade.contractType === 'CALL' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                      }`}
                    >
                      {trade.strike} {trade.contractType}
                    </span>
                    {is0Dte && (
                      <span className="px-1 py-0.2 rounded bg-amber-500/20 text-amber-400 font-bold text-[9px]">
                        0DTE
                      </span>
                    )}
                  </div>

                  <span
                    className={`px-1.5 py-0.5 rounded font-bold text-[9px] ${
                      isBullish ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                    }`}
                  >
                    {trade.sentiment}
                  </span>
                </div>

                <div className="flex items-center justify-between text-slate-400 text-[10px]">
                  <span>
                    {trade.orderType} • {trade.size} contracts @ ${trade.price}
                  </span>
                  <span className="font-bold text-slate-200">
                    ${(trade.premiumUsd / 1000).toFixed(0)}K
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

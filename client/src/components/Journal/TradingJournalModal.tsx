import React from 'react';
import { JournalTrade } from '../../types';
import { BookOpen, X, TrendingUp, TrendingDown, Award, Activity } from 'lucide-react';

interface TradingJournalModalProps {
  isOpen: boolean;
  onClose: () => void;
  trades: JournalTrade[];
}

export const TradingJournalModal: React.FC<TradingJournalModalProps> = ({
  isOpen,
  onClose,
  trades,
}) => {
  if (!isOpen) return null;

  const closedTrades = trades.filter((t) => t.status === 'CLOSED');
  const totalTrades = closedTrades.length;
  const winTrades = closedTrades.filter((t) => (t.pnl || 0) > 0);
  const winRate = totalTrades > 0 ? (winTrades.length / totalTrades) * 100 : 0;
  const netPnl = closedTrades.reduce((acc, t) => acc + (t.pnl || 0), 0);
  const grossProfit = winTrades.reduce((acc, t) => acc + (t.pnl || 0), 0);
  const grossLoss = Math.abs(closedTrades.filter((t) => (t.pnl || 0) <= 0).reduce((acc, t) => acc + (t.pnl || 0), 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99.9 : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm select-none">
      <div className="w-[900px] max-h-[85vh] bg-brand-surface border border-brand-border rounded-lg shadow-2xl flex flex-col font-sans text-xs">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-brand-surfaceHover border-b border-brand-border">
          <div className="flex items-center gap-2 text-slate-100 font-bold text-sm">
            <BookOpen size={16} className="text-amber-400" />
            <span>AUTOMATED ORDERFLOW TRADING JOURNAL & EXECUTION STATS</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={16} />
          </button>
        </div>

        {/* Performance Metric Cards */}
        <div className="grid grid-cols-4 gap-3 p-4 border-b border-brand-border bg-brand-bg/40">
          <div className="p-3 bg-brand-surface rounded border border-brand-border">
            <div className="flex items-center justify-between text-slate-400 text-[11px] mb-1">
              <span>Total PnL</span>
              <Activity size={13} className="text-amber-400" />
            </div>
            <div className={`text-lg font-bold font-mono ${netPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {netPnl >= 0 ? '+' : ''}${netPnl.toFixed(2)}
            </div>
          </div>

          <div className="p-3 bg-brand-surface rounded border border-brand-border">
            <div className="flex items-center justify-between text-slate-400 text-[11px] mb-1">
              <span>Win Rate</span>
              <Award size={13} className="text-emerald-400" />
            </div>
            <div className="text-lg font-bold font-mono text-emerald-400">
              {winRate.toFixed(1)}%
            </div>
          </div>

          <div className="p-3 bg-brand-surface rounded border border-brand-border">
            <div className="flex items-center justify-between text-slate-400 text-[11px] mb-1">
              <span>Profit Factor</span>
              <TrendingUp size={13} className="text-sky-400" />
            </div>
            <div className="text-lg font-bold font-mono text-sky-400">
              {profitFactor.toFixed(2)}
            </div>
          </div>

          <div className="p-3 bg-brand-surface rounded border border-brand-border">
            <div className="flex items-center justify-between text-slate-400 text-[11px] mb-1">
              <span>Trades Logged</span>
              <TrendingDown size={13} className="text-purple-400" />
            </div>
            <div className="text-lg font-bold font-mono text-purple-400">
              {trades.length} ({closedTrades.length} Closed)
            </div>
          </div>
        </div>

        {/* Trades Table */}
        <div className="flex-1 overflow-y-auto p-4">
          <table className="w-full text-left font-mono text-[11px]">
            <thead>
              <tr className="border-b border-brand-border text-slate-400 pb-2">
                <th className="pb-2">Side</th>
                <th className="pb-2">Size</th>
                <th className="pb-2">Entry</th>
                <th className="pb-2">Exit</th>
                <th className="pb-2">PnL</th>
                <th className="pb-2">MAE / MFE</th>
                <th className="pb-2">Footprint Context</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border/20">
              {trades.map((trade) => {
                const isLong = trade.side === 'LONG';
                const pnl = trade.pnl ?? 0;

                return (
                  <tr key={trade.id} className="hover:bg-white/5 py-1.5">
                    <td className="py-2">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          isLong ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                        }`}
                      >
                        {trade.side}
                      </span>
                    </td>
                    <td className="py-2 text-slate-200">{trade.size}</td>
                    <td className="py-2 text-slate-300">{trade.entryPrice.toFixed(1)}</td>
                    <td className="py-2 text-slate-300">
                      {trade.exitPrice ? trade.exitPrice.toFixed(1) : '-'}
                    </td>
                    <td className="py-2 font-bold">
                      {trade.status === 'CLOSED' ? (
                        <span className={pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                          {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} ({trade.pnlPercent}%)
                        </span>
                      ) : (
                        <span className="text-amber-400">OPEN</span>
                      )}
                    </td>
                    <td className="py-2 text-[10px] text-slate-400">
                      <span className="text-rose-400">${trade.mae}</span> /{' '}
                      <span className="text-emerald-400">+${trade.mfe}</span>
                    </td>
                    <td className="py-2 text-[10px] text-slate-300">
                      {trade.imbalanceContext || trade.notes || '-'}
                    </td>
                    <td className="py-2">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] ${
                          trade.status === 'OPEN'
                            ? 'bg-amber-500/20 text-amber-400'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {trade.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

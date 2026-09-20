import React, { useState } from 'react';
import { SlaveAccount } from '../../types';
import { wsClient } from '../../services/websocket';
import { Copy, X, CheckCircle, AlertTriangle, ShieldCheck } from 'lucide-react';

interface TradeCopierModalProps {
  isOpen: boolean;
  onClose: () => void;
  slaves: SlaveAccount[];
}

export const TradeCopierModal: React.FC<TradeCopierModalProps> = ({
  isOpen,
  onClose,
  slaves: initialSlaves,
}) => {
  const [slaves, setSlaves] = useState<SlaveAccount[]>(initialSlaves);

  if (!isOpen) return null;

  const handleToggle = (id: string) => {
    const updated = slaves.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s));
    setSlaves(updated);
    wsClient.updateCopier(updated);
  };

  const handleMultiplierChange = (id: string, multiplier: number) => {
    const updated = slaves.map((s) => (s.id === id ? { ...s, multiplier } : s));
    setSlaves(updated);
    wsClient.updateCopier(updated);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm select-none">
      <div className="w-[600px] bg-brand-surface border border-brand-border rounded-lg shadow-2xl overflow-hidden font-sans text-xs">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-brand-surfaceHover border-b border-brand-border">
          <div className="flex items-center gap-2 text-slate-100 font-bold text-sm">
            <Copy size={16} className="text-amber-400" />
            <span>TRADE COPIER & RISK DISPATCHER</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={16} />
          </button>
        </div>

        {/* Master Account Info */}
        <div className="p-4 border-b border-brand-border bg-brand-bg/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-emerald-400" />
            <div>
              <div className="font-bold text-slate-200">Master Account: Binance Futures Live (DeepChart)</div>
              <div className="text-[11px] text-slate-500">Every market/limit order on DOM is mirrored instantly</div>
            </div>
          </div>
          <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold text-[10px]">
            ACTIVE MASTER
          </span>
        </div>

        {/* Slaves List */}
        <div className="p-4 space-y-3 max-h-[350px] overflow-y-auto">
          {slaves.map((slave) => (
            <div
              key={slave.id}
              className={`p-3 rounded-lg border transition-all ${
                slave.enabled ? 'border-amber-500/30 bg-amber-500/5' : 'border-brand-border bg-brand-bg/30 opacity-60'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={slave.enabled}
                    onChange={() => handleToggle(slave.id)}
                    className="w-4 h-4 rounded text-amber-500 focus:ring-0 cursor-pointer"
                  />
                  <span className="font-bold text-slate-200 text-sm">{slave.name}</span>
                </div>
                <div className="flex items-center gap-1.5 font-mono text-[10px]">
                  {slave.status === 'connected' ? (
                    <span className="flex items-center gap-1 text-emerald-400">
                      <CheckCircle size={12} /> Connected
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-amber-400">
                      <AlertTriangle size={12} /> Idle
                    </span>
                  )}
                  {slave.latencyMs && (
                    <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                      {slave.latencyMs} ms
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between text-slate-400 text-[11px]">
                <div className="flex items-center gap-2">
                  <span>Risk Multiplier:</span>
                  <div className="flex gap-1">
                    {[0.25, 0.5, 1.0, 2.0].map((m) => (
                      <button
                        key={m}
                        onClick={() => handleMultiplierChange(slave.id, m)}
                        className={`px-2 py-0.5 rounded font-mono ${
                          slave.multiplier === m
                            ? 'bg-amber-500 text-black font-bold'
                            : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        {m}x
                      </button>
                    ))}
                  </div>
                </div>

                {slave.lastCopiedOrder && (
                  <span className="text-[10px] text-slate-500 font-mono">
                    Last: {slave.lastCopiedOrder}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="p-3 bg-brand-surfaceHover border-t border-brand-border flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded"
          >
            Save & Close
          </button>
        </div>
      </div>
    </div>
  );
};

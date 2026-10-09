import React, { useEffect, useState, useCallback } from 'react';
import {
  Bell,
  Check,
  Plus,
  Trash2,
  Volume2,
  VolumeX,
  AlertTriangle,
  Info,
  ShieldAlert,
  Clock,
  RefreshCw,
} from 'lucide-react';
import { AlertHistoryItem, AlertRule, AlertType } from '../../types';
import { deepchartApi } from '../../services/api';
import { alertAudio } from '../../services/alertAudio';

interface AlertCenterWidgetProps {
  symbol: string;
  onOpenModal: () => void;
}

export const AlertCenterWidget: React.FC<AlertCenterWidgetProps> = ({
  symbol,
  onOpenModal,
}) => {
  const [tab, setTab] = useState<'stream' | 'rules'>('stream');
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [history, setHistory] = useState<AlertHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isMuted, setIsMuted] = useState(() => alertAudio.getMuted());

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [rRes, hRes] = await Promise.all([
        deepchartApi.listAlertRules(symbol),
        deepchartApi.getAlertHistory({ symbol, limit: 50 }),
      ]);
      setRules(rRes.rules || []);
      setHistory(hRes.history || []);
    } catch (err) {
      console.error('[AlertCenterWidget] Load error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    alertAudio.setMuted(next);
  };

  const handleAck = async (id: string) => {
    try {
      await deepchartApi.acknowledgeAlert(id);
      setHistory((prev) => prev.map((h) => (h.id === id ? { ...h, read: true } : h)));
    } catch {}
  };

  const handleToggleRule = async (rule: AlertRule) => {
    try {
      const updated = await deepchartApi.updateAlertRule(rule.id, { enabled: !rule.enabled });
      setRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)));
    } catch {}
  };

  const handleDeleteRule = async (ruleId: string) => {
    try {
      await deepchartApi.deleteAlertRule(ruleId);
      setRules((prev) => prev.filter((r) => r.id !== ruleId));
    } catch {}
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-100 font-sans text-xs select-none">
      {/* Widget Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 bg-zinc-900/60">
        <div className="flex items-center gap-2">
          <Bell size={13} className="text-amber-400" />
          <span className="font-bold tracking-tight text-white uppercase">{symbol} Alerts</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={toggleMute}
            className="p-1 rounded text-zinc-400 hover:text-zinc-200"
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <VolumeX size={13} className="text-red-400" /> : <Volume2 size={13} className="text-emerald-400" />}
          </button>
          <button
            type="button"
            onClick={loadData}
            className="p-1 rounded text-zinc-400 hover:text-zinc-200"
            title="Refresh"
          >
            <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            onClick={onOpenModal}
            className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold hover:bg-amber-500/30 border border-amber-500/40"
            title="Open Full Alert Center"
          >
            Manage
          </button>
        </div>
      </div>

      {/* Mini Tabs */}
      <div className="flex border-b border-zinc-800 bg-zinc-900/30">
        <button
          type="button"
          onClick={() => setTab('stream')}
          className={`flex-1 py-1.5 text-center font-medium border-b-2 transition-colors ${
            tab === 'stream'
              ? 'border-amber-400 text-amber-300 bg-amber-500/5'
              : 'border-transparent text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Event Feed ({history.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('rules')}
          className={`flex-1 py-1.5 text-center font-medium border-b-2 transition-colors ${
            tab === 'rules'
              ? 'border-amber-400 text-amber-300 bg-amber-500/5'
              : 'border-transparent text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Rules ({rules.length})
        </button>
      </div>

      {/* Widget Body */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {tab === 'stream' && (
          <>
            {history.length === 0 ? (
              <div className="py-12 text-center text-zinc-600">
                <Bell size={20} className="mx-auto mb-1.5 opacity-40" />
                No alert events for {symbol}
              </div>
            ) : (
              history.map((h) => {
                const isCrit = h.severity === 'CRITICAL';
                const isWarn = h.severity === 'WARNING';
                return (
                  <div
                    key={h.id}
                    className={`p-2 rounded border transition-colors ${
                      !h.read
                        ? isCrit
                          ? 'bg-red-950/20 border-red-800/60'
                          : isWarn
                          ? 'bg-amber-950/20 border-amber-800/60'
                          : 'bg-zinc-800/60 border-zinc-700'
                        : 'bg-zinc-900/40 border-zinc-800/80 opacity-70'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            isCrit ? 'bg-red-500' : isWarn ? 'bg-amber-500' : 'bg-blue-500'
                          }`}
                        />
                        <span className="font-bold text-[10px] uppercase text-zinc-300">
                          {h.type.replace('_', ' ')}
                        </span>
                        {h.price > 0 && (
                          <span className="font-mono text-[10px] text-zinc-400">
                            @{h.price.toFixed(2)}
                          </span>
                        )}
                      </div>
                      <span className="text-[9px] font-mono text-zinc-500">
                        {new Date(h.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-300 mt-1 leading-snug">{h.message}</p>
                    {!h.read && (
                      <div className="mt-1 flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleAck(h.id)}
                          className="text-[9px] text-zinc-400 hover:text-white flex items-center gap-0.5"
                        >
                          <Check size={10} /> Mark read
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}

        {tab === 'rules' && (
          <>
            {rules.length === 0 ? (
              <div className="py-12 text-center text-zinc-600">
                <p>No active rules for {symbol}</p>
                <button
                  type="button"
                  onClick={onOpenModal}
                  className="mt-2 text-amber-400 hover:underline font-bold inline-flex items-center gap-1"
                >
                  <Plus size={12} /> Add Rule
                </button>
              </div>
            ) : (
              rules.map((r) => (
                <div
                  key={r.id}
                  className={`p-2 rounded border flex items-center justify-between ${
                    r.enabled
                      ? 'border-zinc-700/80 bg-zinc-800/40'
                      : 'border-zinc-800 bg-zinc-900/30 opacity-60'
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-[10px] uppercase text-amber-400">
                        {r.type.replace('_', ' ')}
                      </span>
                      <span className="text-[10px] font-mono text-zinc-400">
                        threshold: {r.threshold}
                      </span>
                    </div>
                    <div className="text-[9px] text-zinc-500">
                      Cooldown: {r.cooldownSeconds}s
                      {r.lastTriggeredTs ? ` · Last: ${new Date(r.lastTriggeredTs).toLocaleTimeString()}` : ''}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleToggleRule(r)}
                      className={`w-6 h-3.5 rounded-full relative p-0.5 transition-colors ${
                        r.enabled ? 'bg-emerald-500' : 'bg-zinc-700'
                      }`}
                      aria-label="Toggle rule"
                    >
                      <span
                        className={`w-2.5 h-2.5 rounded-full bg-white block transition-transform ${
                          r.enabled ? 'translate-x-2.5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteRule(r.id)}
                      className="text-zinc-500 hover:text-red-400 p-1"
                      aria-label="Delete rule"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
};

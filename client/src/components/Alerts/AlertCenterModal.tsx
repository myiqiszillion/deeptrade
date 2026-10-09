import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Bell,
  BellOff,
  Check,
  Plus,
  Trash2,
  Volume2,
  VolumeX,
  X,
  AlertTriangle,
  Info,
  ShieldAlert,
  Clock,
  Filter,
  RefreshCw,
} from 'lucide-react';
import {
  AlertHistoryItem,
  AlertRule,
  AlertType,
  CreateAlertRuleInput,
} from '../../types';
import { deepchartApi } from '../../services/api';
import { alertAudio } from '../../services/alertAudio';

interface AlertCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentSymbol: string;
  onSelectSymbol?: (symbol: string) => void;
}

const ALERT_TYPE_LABELS: Record<AlertType, { name: string; desc: string; defaultThreshold: number; unit: string }> = {
  STACKED_IMBALANCE: {
    name: 'Stacked Imbalances',
    desc: 'At least 3 consecutive price levels with diagonal imbalance ratio',
    defaultThreshold: 3.0,
    unit: 'ratio (e.g. 3.0x)',
  },
  ABSORPTION: {
    name: 'Order Flow Absorption',
    desc: 'Aggressive market orders absorbed at a resting price wall',
    defaultThreshold: 50,
    unit: 'min lots absorbed',
  },
  LARGE_TRADE: {
    name: 'Large Trade (Whale)',
    desc: 'Single print exceeding institutional threshold',
    defaultThreshold: 25,
    unit: 'min contracts',
  },
  POC_VAH_VAL: {
    name: 'Key Profile Level Touch',
    desc: 'Price approaches or pierces POC, VAH, or VAL within tolerance',
    defaultThreshold: 1.0,
    unit: 'ticks tolerance',
  },
  LIQUIDITY_WALL: {
    name: 'Liquidity Wall Change',
    desc: 'Heavy resting bid/ask size added or pulled in MBP-10',
    defaultThreshold: 100,
    unit: 'min book contracts',
  },
};

export const AlertCenterModal: React.FC<AlertCenterModalProps> = ({
  isOpen,
  onClose,
  currentSymbol,
  onSelectSymbol,
}) => {
  const [activeTab, setActiveTab] = useState<'rules' | 'history' | 'create'>('rules');
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [history, setHistory] = useState<AlertHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filterSymbol, setFilterSymbol] = useState<string>('');
  const [unreadOnly, setUnreadOnly] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(() => alertAudio.getMuted());
  const [volume, setVolume] = useState<number>(() => alertAudio.getVolume());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Create form state
  const [formSymbol, setFormSymbol] = useState(currentSymbol);
  const [formType, setFormType] = useState<AlertType>('STACKED_IMBALANCE');
  const [formThreshold, setFormThreshold] = useState<number>(ALERT_TYPE_LABELS.STACKED_IMBALANCE.defaultThreshold);
  const [formCooldown, setFormCooldown] = useState<number>(30);
  const [formTimeframe, setFormTimeframe] = useState<string>('1m');
  const [formNote, setFormNote] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sync symbol when modal opens
  useEffect(() => {
    if (isOpen) {
      setFormSymbol(currentSymbol);
      fetchData();
    }
  }, [isOpen, currentSymbol]);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [rulesRes, histRes] = await Promise.all([
        deepchartApi.listAlertRules(filterSymbol || undefined),
        deepchartApi.getAlertHistory({
          symbol: filterSymbol || undefined,
          limit: 100,
          unreadOnly,
        }),
      ]);
      setRules(rulesRes.rules || []);
      setHistory(histRes.history || []);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to fetch alerts data');
    } finally {
      setIsLoading(false);
    }
  }, [filterSymbol, unreadOnly]);

  const handleToggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    alertAudio.setMuted(next);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    alertAudio.setVolume(val);
  };

  const handleTestSound = () => {
    alertAudio.play('CRITICAL');
  };

  const handleToggleRule = async (rule: AlertRule) => {
    try {
      const updated = await deepchartApi.updateAlertRule(rule.id, { enabled: !rule.enabled });
      setRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)));
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to update rule');
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    try {
      await deepchartApi.deleteAlertRule(ruleId);
      setRules((prev) => prev.filter((r) => r.id !== ruleId));
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to delete rule');
    }
  };

  const handleAcknowledgeAlert = async (historyId: string) => {
    try {
      await deepchartApi.acknowledgeAlert(historyId);
      setHistory((prev) => prev.map((h) => (h.id === historyId ? { ...h, read: true } : h)));
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to acknowledge alert');
    }
  };

  const handleClearHistory = async () => {
    if (!window.confirm('Clear all triggered alert history?')) return;
    try {
      await deepchartApi.clearAlertHistory(filterSymbol || undefined);
      setHistory([]);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to clear alert history');
    }
  };

  const handleTypeChange = (type: AlertType) => {
    setFormType(type);
    setFormThreshold(ALERT_TYPE_LABELS[type].defaultThreshold);
  };

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formSymbol.trim()) {
      setErrorMessage('Symbol is required');
      return;
    }
    if (formThreshold <= 0) {
      setErrorMessage('Threshold must be positive');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const payload: CreateAlertRuleInput = {
        symbol: formSymbol.trim().toUpperCase(),
        type: formType,
        threshold: formThreshold,
        cooldownSeconds: Math.max(5, formCooldown),
        timeframe: formTimeframe || undefined,
        note: formNote.trim() || undefined,
        enabled: true,
      };
      const created = await deepchartApi.createAlertRule(payload);
      setRules((prev) => [created, ...prev]);
      setActiveTab('rules');
      setFormNote('');
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to create alert rule');
    } finally {
      setIsSubmitting(false);
    }
  };

  const unreadCount = useMemo(() => history.filter((h) => !h.read).length, [history]);

  if (!isOpen) return null;

  return (
    <div
      className="alert-center-modal fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Order Flow Alert Center"
    >
      <div className="relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-100 shadow-2xl overflow-hidden font-sans">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <Bell size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold tracking-tight text-white">Order Flow Alert Center</h2>
                {unreadCount > 0 && (
                  <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-red-500/20 text-red-400 border border-red-500/30">
                    {unreadCount} new
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-400">
                Institutional order flow alerts with zero-latency server evaluation & cooldown protection
              </p>
            </div>
          </div>

          {/* Quick Sound & Close Controls */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-zinc-800/80 border border-zinc-700/60">
              <button
                type="button"
                onClick={handleToggleMute}
                className="text-zinc-400 hover:text-zinc-200 transition-colors"
                title={isMuted ? 'Unmute alert chimes' : 'Mute alert chimes'}
                aria-label="Toggle mute"
              >
                {isMuted ? <VolumeX size={16} className="text-red-400" /> : <Volume2 size={16} className="text-emerald-400" />}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                disabled={isMuted}
                className="w-16 h-1 accent-amber-500 cursor-pointer"
                title={`Volume: ${Math.round(volume * 100)}%`}
                aria-label="Volume slider"
              />
              <button
                type="button"
                onClick={handleTestSound}
                className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300"
                title="Test audio chime"
              >
                Test
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
              aria-label="Close modal"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Tab Navigation & Filters */}
        <div className="flex items-center justify-between px-6 py-2.5 border-b border-zinc-800 bg-zinc-900/90 text-sm">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('rules')}
              className={`px-3 py-1.5 rounded-md font-medium text-xs transition-colors flex items-center gap-1.5 ${
                activeTab === 'rules'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              Active Rules ({rules.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`px-3 py-1.5 rounded-md font-medium text-xs transition-colors flex items-center gap-1.5 ${
                activeTab === 'history'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              Alert History ({history.length})
              {unreadCount > 0 && <span className="w-2 h-2 rounded-full bg-red-500" />}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('create')}
              className={`px-3 py-1.5 rounded-md font-medium text-xs transition-colors flex items-center gap-1.5 ${
                activeTab === 'create'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/30'
              }`}
            >
              <Plus size={14} />
              New Rule
            </button>
          </div>

          {/* Symbol Filter */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-800/80 border border-zinc-700/60 text-xs">
              <Filter size={12} className="text-zinc-400" />
              <input
                type="text"
                placeholder="Filter Symbol (ES, NQ...)"
                value={filterSymbol}
                onChange={(e) => setFilterSymbol(e.target.value.toUpperCase())}
                className="bg-transparent text-zinc-200 focus:outline-none w-28 text-xs font-mono"
              />
              {filterSymbol && (
                <button
                  type="button"
                  onClick={() => setFilterSymbol('')}
                  className="text-zinc-500 hover:text-zinc-300"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {activeTab === 'history' && (
              <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={unreadOnly}
                  onChange={(e) => setUnreadOnly(e.target.checked)}
                  className="rounded border-zinc-700 text-amber-500 focus:ring-0"
                />
                Unread only
              </label>
            )}

            <button
              type="button"
              onClick={fetchData}
              disabled={isLoading}
              className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200"
              title="Refresh"
            >
              <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Error Banner */}
        {errorMessage && (
          <div className="px-6 py-2 bg-red-950/60 border-b border-red-800/80 text-red-300 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} className="text-red-400 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="text-red-400 hover:text-red-200"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 min-h-[350px]">
          {/* TAB 1: ACTIVE RULES */}
          {activeTab === 'rules' && (
            <div className="space-y-3">
              {rules.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="p-3 rounded-full bg-zinc-800 text-zinc-500 mb-3">
                    <BellOff size={28} />
                  </div>
                  <h3 className="text-sm font-semibold text-zinc-300">No active alert rules</h3>
                  <p className="text-xs text-zinc-500 mt-1 max-w-sm">
                    Create rules for Stacked Imbalances, Order Flow Absorption, Whale Prints, or Profile Level touches.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('create')}
                    className="mt-4 px-3 py-1.5 rounded-md bg-amber-500 text-zinc-950 font-bold text-xs hover:bg-amber-400 transition-colors inline-flex items-center gap-1.5"
                  >
                    <Plus size={14} />
                    Create First Alert Rule
                  </button>
                </div>
              ) : (
                rules.map((rule) => {
                  const meta = ALERT_TYPE_LABELS[rule.type] || {
                    name: rule.type,
                    desc: '',
                    unit: '',
                  };
                  return (
                    <div
                      key={rule.id}
                      className={`flex items-center justify-between p-4 rounded-lg border transition-all ${
                        rule.enabled
                          ? 'border-zinc-700/80 bg-zinc-800/40 hover:border-zinc-600'
                          : 'border-zinc-800 bg-zinc-900/40 opacity-60'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          onClick={() => handleToggleRule(rule)}
                          className={`mt-0.5 w-8 h-4.5 rounded-full transition-colors relative flex items-center p-0.5 ${
                            rule.enabled ? 'bg-emerald-500' : 'bg-zinc-700'
                          }`}
                          title={rule.enabled ? 'Click to disable' : 'Click to enable'}
                          aria-label={`Toggle rule ${rule.id}`}
                        >
                          <span
                            className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${
                              rule.enabled ? 'translate-x-3.5' : 'translate-x-0'
                            }`}
                          />
                        </button>

                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-sm text-white">{rule.symbol}</span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-amber-500/10 text-amber-400 border border-amber-500/20">
                              {meta.name}
                            </span>
                            {rule.timeframe && (
                              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-zinc-800 text-zinc-400">
                                {rule.timeframe}
                              </span>
                            )}
                          </div>

                          <div className="text-xs text-zinc-300 mt-1">
                            Threshold: <span className="font-mono font-semibold text-amber-300">{rule.threshold}</span> {meta.unit}
                            <span className="text-zinc-500 mx-2">·</span>
                            Cooldown: <span className="font-mono text-zinc-400">{rule.cooldownSeconds}s</span>
                          </div>

                          {rule.note && (
                            <p className="text-xs text-zinc-400 italic mt-0.5">{rule.note}</p>
                          )}

                          {rule.lastTriggeredTs && (
                            <div className="flex items-center gap-1 text-[10px] text-zinc-500 mt-1">
                              <Clock size={10} />
                              Last fired: {new Date(rule.lastTriggeredTs).toLocaleTimeString()}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleDeleteRule(rule.id)}
                          className="p-1.5 rounded text-zinc-500 hover:text-red-400 hover:bg-red-950/20 transition-colors"
                          title="Delete rule"
                          aria-label="Delete rule"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* TAB 2: ALERT HISTORY */}
          {activeTab === 'history' && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between pb-2 border-b border-zinc-800 text-xs text-zinc-400">
                <span>Recent Triggered Events (Max 100)</span>
                {history.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearHistory}
                    className="text-red-400 hover:text-red-300 text-xs font-semibold"
                  >
                    Clear History
                  </button>
                )}
              </div>

              {history.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="p-3 rounded-full bg-zinc-800 text-zinc-500 mb-3">
                    <ShieldAlert size={28} />
                  </div>
                  <h3 className="text-sm font-semibold text-zinc-300">No alert history</h3>
                  <p className="text-xs text-zinc-500 mt-1">
                    When order flow conditions match your active rules, events will be logged here.
                  </p>
                </div>
              ) : (
                history.map((item) => {
                  const isCritical = item.severity === 'CRITICAL';
                  const isWarning = item.severity === 'WARNING';
                  return (
                    <div
                      key={item.id}
                      className={`flex items-start justify-between p-3 rounded-lg border transition-all ${
                        !item.read
                          ? isCritical
                            ? 'bg-red-950/20 border-red-800/60'
                            : isWarning
                            ? 'bg-amber-950/20 border-amber-800/60'
                            : 'bg-zinc-800/60 border-zinc-700'
                          : 'bg-zinc-900/60 border-zinc-800/80 opacity-75'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`p-1.5 rounded mt-0.5 ${
                            isCritical
                              ? 'bg-red-500/20 text-red-400'
                              : isWarning
                              ? 'bg-amber-500/20 text-amber-400'
                              : 'bg-blue-500/20 text-blue-400'
                          }`}
                        >
                          {isCritical ? <ShieldAlert size={15} /> : isWarning ? <AlertTriangle size={15} /> : <Info size={15} />}
                        </div>

                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-xs text-white">{item.symbol}</span>
                            <span
                              className={`px-1.5 py-0.2 rounded text-[9px] font-bold tracking-wider uppercase ${
                                isCritical
                                  ? 'bg-red-500/20 text-red-400'
                                  : isWarning
                                  ? 'bg-amber-500/20 text-amber-400'
                                  : 'bg-blue-500/20 text-blue-400'
                              }`}
                            >
                              {item.severity}
                            </span>
                            <span className="text-[10px] font-mono text-zinc-500">
                              {new Date(item.timestamp).toLocaleTimeString()}
                            </span>
                            {item.price > 0 && (
                              <span className="px-1.5 py-0.2 rounded bg-zinc-800 font-mono text-[10px] font-semibold text-zinc-200">
                                @ {item.price.toFixed(2)}
                              </span>
                            )}
                          </div>

                          <p className="text-xs text-zinc-200 mt-1 leading-snug">{item.message}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 ml-4">
                        {!item.read && (
                          <button
                            type="button"
                            onClick={() => handleAcknowledgeAlert(item.id)}
                            className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-[10px] font-semibold text-zinc-300 flex items-center gap-1"
                            title="Mark as read"
                          >
                            <Check size={12} />
                            Ack
                          </button>
                        )}
                        {onSelectSymbol && item.symbol !== currentSymbol && (
                          <button
                            type="button"
                            onClick={() => {
                              onSelectSymbol(item.symbol);
                              onClose();
                            }}
                            className="px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-[10px] font-semibold"
                          >
                            View {item.symbol}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* TAB 3: CREATE RULE FORM */}
          {activeTab === 'create' && (
            <form onSubmit={handleCreateRule} className="max-w-xl mx-auto space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">
                    Symbol <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={formSymbol}
                    onChange={(e) => setFormSymbol(e.target.value.toUpperCase())}
                    placeholder="ES, NQ, CL..."
                    required
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-white font-mono text-sm focus:border-amber-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">Timeframe</label>
                  <select
                    value={formTimeframe}
                    onChange={(e) => setFormTimeframe(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-white text-sm focus:border-amber-500 focus:outline-none"
                  >
                    <option value="1s">1 second</option>
                    <option value="5s">5 seconds</option>
                    <option value="15s">15 seconds</option>
                    <option value="30s">30 seconds</option>
                    <option value="1m">1 minute</option>
                    <option value="5m">5 minutes</option>
                    <option value="15m">15 minutes</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  Alert Strategy Type <span className="text-red-400">*</span>
                </label>
                <div className="grid grid-cols-1 gap-2">
                  {(Object.keys(ALERT_TYPE_LABELS) as AlertType[]).map((type) => {
                    const info = ALERT_TYPE_LABELS[type];
                    const selected = formType === type;
                    return (
                      <div
                        key={type}
                        onClick={() => handleTypeChange(type)}
                        className={`p-3 rounded-lg border cursor-pointer transition-all ${
                          selected
                            ? 'bg-amber-500/15 border-amber-500 text-white'
                            : 'bg-zinc-800/60 border-zinc-700/60 text-zinc-300 hover:border-zinc-600'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold">{info.name}</span>
                          <span className="text-[10px] font-mono text-zinc-400">Unit: {info.unit}</span>
                        </div>
                        <p className="text-[11px] text-zinc-400 mt-0.5">{info.desc}</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">
                    Threshold ({ALERT_TYPE_LABELS[formType].unit}) <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={formThreshold}
                    onChange={(e) => setFormThreshold(parseFloat(e.target.value) || 0)}
                    required
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-white font-mono text-sm focus:border-amber-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">Cooldown (Seconds)</label>
                  <input
                    type="number"
                    min="5"
                    step="5"
                    value={formCooldown}
                    onChange={(e) => setFormCooldown(parseInt(e.target.value, 10) || 30)}
                    className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-white font-mono text-sm focus:border-amber-500 focus:outline-none"
                  />
                  <span className="text-[10px] text-zinc-500 mt-0.5 block">Suppresses repeated alerts within this window</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">Custom Note (Optional)</label>
                <input
                  type="text"
                  value={formNote}
                  onChange={(e) => setFormNote(e.target.value)}
                  placeholder="e.g. Alert me on 3x stacked buy imbalances during London open"
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-white text-sm focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setActiveTab('rules')}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-zinc-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs transition-colors flex items-center gap-1.5 shadow-lg shadow-amber-500/20 disabled:opacity-50"
                >
                  {isSubmitting ? 'Creating...' : 'Activate Rule'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import { Activity, X, Server, Database, Radio, RefreshCw, ShieldCheck } from 'lucide-react';
import { CoverageItem, deepchartApi, SystemStatus } from '../../services/api';

interface SystemStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeSymbol: string;
}

export const SystemStatusModal: React.FC<SystemStatusModalProps> = ({ isOpen, onClose, activeSymbol }) => {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [coverage, setCoverage] = useState<CoverageItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'system' | 'coverage' | 'apis'>('system');

  const refreshData = async () => {
    setIsLoading(true);
    try {
      const [statusData, coverageData] = await Promise.all([
        deepchartApi.getStatus(),
        deepchartApi.getCoverage(),
      ]);
      setStatus(statusData);
      setCoverage(coverageData);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    if (isOpen) {
      Promise.all([deepchartApi.getStatus(), deepchartApi.getCoverage()])
        .then(([statusData, coverageData]) => {
          if (!active) return;
          setStatus(statusData);
          setCoverage(coverageData);
          setIsLoading(false);
        })
        .catch(() => {
          if (!active) return;
          setIsLoading(false);
        });
    }
    return () => {
      active = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-[820px] max-w-full bg-[#0d121c] border border-slate-800 rounded-xl shadow-2xl flex flex-col max-h-[88vh] overflow-hidden text-slate-200 text-xs">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <Activity size={18} className="text-cyan-400" />
            <span className="font-bold text-sm tracking-tight text-white">System Diagnostics & API Hub</span>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
              REST v1 + WS
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void refreshData()}
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title="Refresh status"
            >
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title="Close modal"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800 px-5 pt-2 bg-slate-950/40 gap-2">
          {(['system', 'coverage', 'apis'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 font-medium border-b-2 transition-all capitalize ${
                activeTab === tab
                  ? 'border-cyan-400 text-cyan-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab === 'system' ? 'Platform Status' : tab === 'coverage' ? 'Capability Matrix' : 'Live Endpoints'}
            </button>
          ))}
        </div>

        {/* Modal Content */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {activeTab === 'system' && (
            <div className="space-y-4">
              {/* High-level status cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-800">
                  <div className="text-slate-400 text-[11px] mb-1 flex items-center gap-1.5">
                    <Server size={13} className="text-cyan-400" />
                    <span>Server Uptime</span>
                  </div>
                  <div className="text-sm font-bold text-white font-mono">
                    {status ? `${Math.floor(status.uptimeSec / 60)}m ${status.uptimeSec % 60}s` : '—'}
                  </div>
                </div>

                <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-800">
                  <div className="text-slate-400 text-[11px] mb-1 flex items-center gap-1.5">
                    <Radio size={13} className="text-emerald-400" />
                    <span>WS Sessions</span>
                  </div>
                  <div className="text-sm font-bold text-emerald-400 font-mono">
                    {status ? `${status.sessions} active` : '—'}
                  </div>
                </div>

                <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-800">
                  <div className="text-slate-400 text-[11px] mb-1 flex items-center gap-1.5">
                    <Database size={13} className="text-amber-400" />
                    <span>Futures Provider</span>
                  </div>
                  <div className="text-sm font-bold text-amber-300 font-mono uppercase">
                    {status?.futuresProvider || 'none'}
                  </div>
                </div>

                <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-800">
                  <div className="text-slate-400 text-[11px] mb-1 flex items-center gap-1.5">
                    <ShieldCheck size={13} className="text-purple-400" />
                    <span>Active Contexts</span>
                  </div>
                  <div className="text-sm font-bold text-white font-mono">
                    {status?.activeContexts.length ?? 0} instruments
                  </div>
                </div>
              </div>

              {/* Active Feeds Table */}
              <div>
                <h4 className="text-xs font-semibold text-slate-300 mb-2 uppercase tracking-wider">
                  Active Market Contexts & Feed Health
                </h4>
                <div className="overflow-x-auto border border-slate-800 rounded-lg bg-slate-950/60">
                  <table className="w-full text-left font-mono text-[11px]">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 bg-slate-900/40">
                        <th className="py-2 px-3">Symbol</th>
                        <th className="py-2 px-3">Provider</th>
                        <th className="py-2 px-3">Status</th>
                        <th className="py-2 px-3">Subscribers</th>
                        <th className="py-2 px-3">Last Trade</th>
                        <th className="py-2 px-3">Last Depth</th>
                      </tr>
                    </thead>
                    <tbody>
                      {status?.activeContexts.map((ctx) => (
                        <tr
                          key={ctx.symbol}
                          className={`border-b border-slate-800/50 hover:bg-slate-800/30 ${
                            ctx.symbol === activeSymbol ? 'bg-cyan-500/5' : ''
                          }`}
                        >
                          <td className="py-2 px-3 font-bold text-white">
                            {ctx.symbol}
                            {ctx.symbol === activeSymbol && (
                              <span className="ml-1.5 px-1 py-0.2 rounded text-[9px] bg-cyan-500/20 text-cyan-300">
                                ACTIVE
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 uppercase text-slate-300">{ctx.provider}</td>
                          <td className="py-2 px-3">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                ctx.feedStatus === 'LIVE'
                                  ? 'bg-emerald-500/20 text-emerald-400'
                                  : 'bg-amber-500/20 text-amber-400'
                              }`}
                            >
                              {ctx.feedStatus}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-slate-300">{ctx.subscribers}</td>
                          <td className="py-2 px-3 text-slate-400">
                            {ctx.lastTradeTs > 0 ? new Date(ctx.lastTradeTs).toLocaleTimeString() : '—'}
                          </td>
                          <td className="py-2 px-3 text-slate-400">
                            {ctx.lastDepthTs > 0 ? new Date(ctx.lastDepthTs).toLocaleTimeString() : '—'}
                          </td>
                        </tr>
                      ))}
                      {(!status || status.activeContexts.length === 0) && (
                        <tr>
                          <td colSpan={6} className="py-4 text-center text-slate-500">
                            No market contexts initialized yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'coverage' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-xs">
                  Fail-Closed Capability Matrix: only real feeds stream live order flow.
                </span>
                <span className="text-[11px] font-mono text-cyan-400">{coverage.length} instruments registered</span>
              </div>
              <div className="overflow-x-auto border border-slate-800 rounded-lg bg-slate-950/60 max-h-[50vh]">
                <table className="w-full text-left font-mono text-[11px]">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 bg-slate-900/40 sticky top-0">
                      <th className="py-2 px-3">Symbol</th>
                      <th className="py-2 px-3">Exchange</th>
                      <th className="py-2 px-3">Provider</th>
                      <th className="py-2 px-3">Realtime</th>
                      <th className="py-2 px-3">History</th>
                      <th className="py-2 px-3">Footprint</th>
                      <th className="py-2 px-3">DOM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coverage.map((c) => (
                      <tr
                        key={c.symbol}
                        className={`border-b border-slate-800/40 hover:bg-slate-800/30 ${
                          c.symbol === activeSymbol ? 'bg-cyan-500/5' : ''
                        }`}
                      >
                        <td className="py-1.5 px-3 font-bold text-white">{c.symbol}</td>
                        <td className="py-1.5 px-3 text-slate-400">{c.exchange}</td>
                        <td className="py-1.5 px-3 uppercase text-slate-300">{c.provider}</td>
                        <td className="py-1.5 px-3">
                          <span
                            className={
                              c.realtime === 'LIVE' ? 'text-emerald-400 font-bold' : 'text-amber-400/80'
                            }
                          >
                            {c.realtime}
                          </span>
                        </td>
                        <td className="py-1.5 px-3 text-slate-300">{c.history}</td>
                        <td className="py-1.5 px-3 text-slate-300">{c.footprint}</td>
                        <td className="py-1.5 px-3 text-slate-300">{c.orderbook}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'apis' && (
            <div className="space-y-3">
              <span className="text-slate-400 text-xs">
                DeepChart Unified REST API v1 — accessible via HTTP or same-origin on port 8080:
              </span>
              <div className="grid grid-cols-1 gap-2 font-mono text-[11px]">
                {[
                  { method: 'GET', path: '/api/v1/instruments', desc: 'List all supported instruments with tick sizes, margins & status' },
                  { method: 'GET', path: '/api/v1/instruments/:symbol', desc: 'Detailed metadata and context status for a single contract' },
                  { method: 'GET', path: '/api/v1/history?symbol=ES&timeframe=1m&limit=300', desc: 'Query historical OHLCV bars with buy/sell delta' },
                  { method: 'GET', path: '/api/v1/trades?symbol=ES&limit=100', desc: 'Query persistent trade and tick history from SQLite' },
                  { method: 'GET', path: '/api/v1/gex?symbol=SPX', desc: 'Gamma Exposure profile computed from CBOE delayed option chain' },
                  { method: 'GET', path: '/api/v1/options-flow?symbol=SPX', desc: 'Notable option block and sweep trades from options chain' },
                  { method: 'GET', path: '/api/v1/gaps?symbol=ES', desc: 'Sequence and market data gap detection records' },
                  { method: 'GET', path: '/api/v1/coverage', desc: 'Data capability matrix across all instruments' },
                  { method: 'GET', path: '/api/v1/replay/stats?symbol=ES', desc: 'Available tick counts and date bounds for market replay' },
                  { method: 'POST', path: '/api/v1/auth/login', desc: 'Authenticate and receive signed JWT token' },
                  { method: 'GET', path: '/api/v1/auth/me', desc: 'Verify JWT and return user entitlements' },
                  { method: 'GET', path: '/healthz', desc: 'Realtime engine status and connection health' },
                  { method: 'GET', path: '/metrics', desc: 'Prometheus-compatible memory and performance metrics' },
                ].map((api) => (
                  <div
                    key={api.path}
                    className="p-2.5 rounded-lg bg-slate-900/50 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          api.method === 'GET'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-blue-500/20 text-blue-400'
                        }`}
                      >
                        {api.method}
                      </span>
                      <span className="text-white font-semibold">{api.path}</span>
                    </div>
                    <span className="text-slate-400 text-[10px] sm:text-right">{api.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-900/40 flex items-center justify-between">
          <span className="text-[11px] text-slate-500">
            DeepChart Free Engine · Node.js {status?.nodeVersion || 'v24'} · SQLite WAL
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-white font-semibold transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

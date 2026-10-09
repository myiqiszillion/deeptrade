import React, { useEffect, useMemo, useState } from 'react';
import { ChartLevels, OptionChainResponse, OptionContract } from '../../types';
import { deepchartApi } from '../../services/api';
import { Activity, Layers, RefreshCw } from 'lucide-react';

interface OptionsChainWidgetProps {
  symbol: string;
  currentPrice: number;
}

export const OptionsChainWidget: React.FC<OptionsChainWidgetProps> = ({ symbol, currentPrice }) => {
  const [chain, setChain] = useState<OptionChainResponse | null>(null);
  const [levels, setLevels] = useState<ChartLevels | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedExp, setSelectedExp] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Map futures symbol to corresponding options underlying (ES -> SPY, NQ -> QQQ, etc.)
  const underlying = useMemo(() => {
    const s = symbol.toUpperCase();
    if (s === 'ES' || s === 'MES') return 'SPY';
    if (s === 'NQ' || s === 'MNQ') return 'QQQ';
    if (s === 'YM' || s === 'MYM') return 'DIA';
    if (s === 'RTY' || s === 'M2K') return 'IWM';
    return s;
  }, [symbol]);

  const fetchChain = async () => {
    setLoading(true);
    setError(null);
    try {
      const [chainData, levelsData] = await Promise.all([
        deepchartApi.getOptionsChain(underlying),
        deepchartApi.getChartLevels(symbol).catch(() => null),
      ]);
      setChain(chainData);
      setLevels(levelsData);
    } catch (err: any) {
      setError(err?.message || 'Failed to load options chain');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchChain();
  }, [underlying, symbol]);

  // Extract unique sorted expirations
  const expirations = useMemo(() => {
    if (!chain || !chain.contracts) return [];
    const set = new Set<string>();
    for (const c of chain.contracts) {
      if (c.expiration) set.add(c.expiration);
    }
    return Array.from(set).sort();
  }, [chain]);

  // Set default expiration when available
  useEffect(() => {
    if (expirations.length > 0 && (!selectedExp || !expirations.includes(selectedExp))) {
      setSelectedExp(expirations[0]);
    }
  }, [expirations, selectedExp]);

  // Group calls and puts by strike for selected expiration
  const { strikes, callsByStrike, putsByStrike } = useMemo(() => {
    const callsMap = new Map<number, OptionContract>();
    const putsMap = new Map<number, OptionContract>();
    const strikeSet = new Set<number>();

    if (chain && chain.contracts) {
      for (const c of chain.contracts) {
        if (!selectedExp || c.expiration === selectedExp) {
          strikeSet.add(c.strike);
          if (c.type === 'call') {
            callsMap.set(c.strike, c);
          } else {
            putsMap.set(c.strike, c);
          }
        }
      }
    }

    const sortedStrikes = Array.from(strikeSet).sort((a, b) => a - b);
    return {
      strikes: sortedStrikes,
      callsByStrike: callsMap,
      putsByStrike: putsMap,
    };
  }, [chain, selectedExp]);

  const effectiveSpot = chain?.spotPrice && chain.spotPrice > 0 ? chain.spotPrice : currentPrice;

  // Closest strike to spot
  const atmStrike = useMemo(() => {
    if (strikes.length === 0 || effectiveSpot <= 0) return null;
    return strikes.reduce((closest, s) =>
      Math.abs(s - effectiveSpot) < Math.abs(closest - effectiveSpot) ? s : closest
    , strikes[0]);
  }, [strikes, effectiveSpot]);

  if (loading && !chain) {
    return (
      <div className="w-full h-full p-4 flex flex-col items-center justify-center text-slate-400 font-mono text-xs gap-2">
        <RefreshCw className="animate-spin text-cyan-400" size={18} />
        <span>Loading institutional options chain ({underlying})...</span>
      </div>
    );
  }

  if (error || !chain || chain.contracts.length === 0) {
    return (
      <div className="w-full h-full p-4 flex flex-col justify-center items-center text-slate-400 text-center font-mono text-xs gap-3 select-none">
        <Layers size={24} className="text-amber-400" />
        <span className="font-bold text-amber-400">OPTIONS CHAIN: UNAVAILABLE</span>
        <p className="max-w-xs text-[11px] text-slate-400">
          No active option chain found for <b>{underlying}</b> ({symbol}).
        </p>
        <div className="text-[10px] text-slate-500 bg-slate-900/80 p-2.5 rounded border border-white/5 space-y-1 text-left">
          <div>• Requires Databento OPRA options dataset subscription or stored definitions.</div>
          <div>• Fail-Closed: DeepChart never synthesizes imaginary option strikes.</div>
        </div>
        <button
          onClick={fetchChain}
          className="mt-2 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-white/10 flex items-center gap-1.5 transition-colors"
        >
          <RefreshCw size={11} /> Refresh Chain
        </button>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col select-none font-mono text-xs bg-slate-950/40">
      {/* Header */}
      <div className="border-b border-white/5 p-2 bg-slate-900/60 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-bold text-slate-200">
            <Layers size={14} className="text-cyan-400" />
            <span>OPTIONS CHAIN · {underlying}</span>
            <span className="text-[9px] px-1 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-normal">
              {chain.source.toUpperCase()}
            </span>
          </div>
          <button
            onClick={fetchChain}
            disabled={loading}
            className="p-1 text-slate-400 hover:text-slate-200 transition-colors"
            title="Refresh chain"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Expiration Selector & Spot Stats */}
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 text-[10px]">Expiry:</span>
            <select
              value={selectedExp}
              onChange={(e) => setSelectedExp(e.target.value)}
              className="bg-slate-800 text-slate-200 rounded px-2 py-0.5 text-[11px] border border-white/10 outline-none"
            >
              {expirations.map((exp) => (
                <option key={exp} value={exp}>
                  {exp}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 text-[10px] text-slate-400">
            <span>PCR: <b className="text-slate-200">{chain.putCallRatio}</b></span>
            <span>Call OI: <b className="text-emerald-400">{chain.totalCallOi.toLocaleString()}</b></span>
            <span>Put OI: <b className="text-rose-400">{chain.totalPutOi.toLocaleString()}</b></span>
          </div>
        </div>

        {/* Key Levels Bar if available */}
        {levels && (
          <div className="grid grid-cols-3 gap-1 text-[10px] text-center pt-1 border-t border-white/5">
            <div className="p-1 bg-slate-900/80 rounded border border-white/5">
              <span className="text-slate-500">Put Wall: </span>
              <span className="text-rose-400 font-bold">{levels.putWall ?? '--'}</span>
            </div>
            <div className="p-1 bg-slate-900/80 rounded border border-white/5">
              <span className="text-slate-500">Gamma Flip: </span>
              <span className="text-amber-400 font-bold">{levels.gammaFlip ?? '--'}</span>
            </div>
            <div className="p-1 bg-slate-900/80 rounded border border-white/5">
              <span className="text-slate-500">Call Wall: </span>
              <span className="text-emerald-400 font-bold">{levels.callWall ?? '--'}</span>
            </div>
          </div>
        )}
      </div>

      {/* Table Header */}
      <div className="grid grid-cols-7 text-[10px] font-semibold text-slate-500 border-b border-white/5 bg-slate-900/40 px-2 py-1 text-center">
        <div className="text-emerald-400">Call IV</div>
        <div className="text-emerald-400">Call OI</div>
        <div className="text-emerald-400">Delta</div>
        <div className="text-slate-300 font-bold bg-slate-800/50">STRIKE</div>
        <div className="text-rose-400">Delta</div>
        <div className="text-rose-400">Put OI</div>
        <div className="text-rose-400">Put IV</div>
      </div>

      {/* Strikes List */}
      <div className="flex-1 overflow-y-auto divide-y divide-white/5 text-[10px]">
        {strikes.map((s) => {
          const call = callsByStrike.get(s);
          const put = putsByStrike.get(s);
          const isAtm = s === atmStrike;
          const isCallWall = levels?.callWall === s;
          const isPutWall = levels?.putWall === s;
          const isFlip = levels?.gammaFlip === s;

          return (
            <div
              key={s}
              className={`grid grid-cols-7 items-center px-2 py-1 text-center transition-colors hover:bg-slate-800/40 ${
                isAtm ? 'bg-cyan-500/10' : ''
              }`}
            >
              {/* Call Columns */}
              <div className="text-slate-400">
                {call?.iv ? `${(call.iv * 100).toFixed(1)}%` : '--'}
              </div>
              <div className="text-emerald-400/90">
                {call?.openInterest?.toLocaleString() ?? (call?.volume ? call.volume.toLocaleString() : '--')}
              </div>
              <div className="text-slate-300">
                {call?.delta ? call.delta.toFixed(2) : '--'}
              </div>

              {/* Center Strike Column */}
              <div
                className={`font-bold relative py-0.5 rounded ${
                  isAtm
                    ? 'text-cyan-300 bg-cyan-900/40 border border-cyan-500/40'
                    : isCallWall
                    ? 'text-emerald-400 bg-emerald-950/40 border border-emerald-500/30'
                    : isPutWall
                    ? 'text-rose-400 bg-rose-950/40 border border-rose-500/30'
                    : isFlip
                    ? 'text-amber-400 bg-amber-950/40 border border-amber-500/30'
                    : 'text-slate-200'
                }`}
              >
                {s}
                {isAtm && <span className="absolute -top-1 right-0 text-[8px] text-cyan-400 font-normal">ATM</span>}
                {isCallWall && <span className="absolute -top-1 left-0 text-[7px] text-emerald-400">CW</span>}
                {isPutWall && <span className="absolute -top-1 left-0 text-[7px] text-rose-400">PW</span>}
              </div>

              {/* Put Columns */}
              <div className="text-slate-300">
                {put?.delta ? put.delta.toFixed(2) : '--'}
              </div>
              <div className="text-rose-400/90">
                {put?.openInterest?.toLocaleString() ?? (put?.volume ? put.volume.toLocaleString() : '--')}
              </div>
              <div className="text-slate-400">
                {put?.iv ? `${(put.iv * 100).toFixed(1)}%` : '--'}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

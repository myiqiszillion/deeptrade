import React, { useState } from 'react';
import { quantApi } from '../../services/quantApi';

export const BacktestPanel: React.FC<{ symbol: string }> = ({ symbol }) => {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [gexBelow, setGexBelow] = useState<string>('');
  const run = async () => {
    setLoading(true);
    try {
      const body: any = { underlying: symbol, horizonBars: 390 };
      if (gexBelow.trim() !== '') body.gexBelow = Number(gexBelow);
      const r = await quantApi.runBacktest(body);
      setResult(r);
    } catch (e: any) { setResult({ error: String(e) }); } finally { setLoading(false); }
  };
  return (
    <div className="p-3 space-y-2">
      <div className="font-mono text-[11px] text-[#7F8B97] uppercase tracking-wide">Backtest — {symbol}</div>
      <div className="flex gap-2">
        <input value={gexBelow} onChange={e=>setGexBelow(e.target.value)} placeholder="GEX below (e.g. 0)" className="flex-1 bg-[#0B0F14] border border-[#1C2630] rounded px-2 py-1 font-mono text-xs text-[#E7EDF3]" />
        <button onClick={run} disabled={loading} className="px-3 py-1 bg-[#1C2630] text-[#E7EDF3] rounded font-mono text-xs disabled:opacity-50">{loading ? '…' : 'Run'}</button>
      </div>
      {result && !result.error && (
        <div className="font-mono text-xs space-y-1 bg-[#10151C] border border-[#1C2630] rounded p-2">
          <div>Occurrences: <span className="text-[#E7EDF3]">{result.occurrences}</span></div>
          <div>Avg move: <span className="text-[#E7EDF3]">{result.avgMove != null ? (result.avgMove*100).toFixed(2)+'%' : '—'}</span> · Median: {result.medianMove != null ? (result.medianMove*100).toFixed(2)+'%' : '—'}</div>
          <div>MFE: {result.mfe != null ? (result.mfe*100).toFixed(2)+'%' : '—'} · MAE: {result.mae != null ? (result.mae*100).toFixed(2)+'%' : '—'}</div>
        </div>
      )}
      {result?.error && <div className="text-xs text-red-400">{result.error}</div>}
    </div>
  );
};

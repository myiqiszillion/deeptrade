import React, { useState } from 'react';
import { quantApi } from '../../services/quantApi';

export const ResearchLabPanel: React.FC<{ symbol: string }> = ({ symbol }) => {
  const [gexBelow, setGexBelow] = useState('');
  const [ivAbove, setIvAbove] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const run = async () => {
    setLoading(true);
    try {
      const body: any = { underlying: symbol };
      if (gexBelow.trim() !== '') body.gexBelow = Number(gexBelow);
      if (ivAbove.trim() !== '') body.ivAbove = Number(ivAbove);
      const r = await quantApi.queryLab(body);
      setResult(r);
    } catch (e: any) { setResult({ error: String(e) }); } finally { setLoading(false); }
  };
  return (
    <div className="p-3 space-y-2">
      <div className="font-mono text-[11px] text-[#7F8B97] uppercase tracking-wide">Research Lab — {symbol}</div>
      <div className="text-[11px] text-[#7F8B97]">Query local snapshots/bars (no vendor cost).</div>
      <div className="grid grid-cols-2 gap-2">
        <input value={gexBelow} onChange={e=>setGexBelow(e.target.value)} placeholder="GEX < (e.g. 0)" className="bg-[#0B0F14] border border-[#1C2630] rounded px-2 py-1 font-mono text-xs text-[#E7EDF3]" />
        <input value={ivAbove} onChange={e=>setIvAbove(e.target.value)} placeholder="IV > (e.g. 0.20)" className="bg-[#0B0F14] border border-[#1C2630] rounded px-2 py-1 font-mono text-xs text-[#E7EDF3]" />
      </div>
      <button onClick={run} disabled={loading} className="w-full py-1 bg-[#1C2630] text-[#E7EDF3] rounded font-mono text-xs disabled:opacity-50">{loading ? '…' : 'Query'}</button>
      {result && !result.error && (
        <div className="font-mono text-xs space-y-1 bg-[#10151C] border border-[#1C2630] rounded p-2">
          <div>Occurrences: <span className="text-[#E7EDF3]">{result.occurrences}</span></div>
          <div>Median next-day: {result.medianNextDayReturn != null ? (result.medianNextDayReturn*100).toFixed(2)+'%' : '—'} · Median range: {result.medianRange != null ? (result.medianRange*100).toFixed(2)+'%' : '—'}</div>
        </div>
      )}
      {result?.error && <div className="text-xs text-red-400">{result.error}</div>}
    </div>
  );
};

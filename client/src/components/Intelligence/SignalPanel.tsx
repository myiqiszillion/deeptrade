import React, { useEffect, useState } from 'react';
import { quantApi } from '../../services/quantApi';

export const SignalPanel: React.FC<{ symbol: string }> = ({ symbol }) => {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setErr(null);
    quantApi.getSignals(symbol).then(d => { if (!cancelled) setData(d); }).catch(e => { if (!cancelled) setErr(String(e)); });
    const id = setInterval(() => quantApi.getSignals(symbol).then(d => { if (!cancelled) setData(d); }).catch(()=>{}), 60000);
    return () => { cancelled = true; clearInterval(id); };
  }, [symbol]);
  if (err) return <div className="p-3 text-xs text-red-400">{err}</div>;
  if (!data) return <div className="p-3 text-xs text-[#7F8B97]">Loading signals…</div>;
  const scores = data.scores ?? {};
  const renderScore = (v: number) => '—'.repeat(1) + '+'.repeat(v) || '—';
  return (
    <div className="p-3 space-y-2">
      <div className="font-mono text-[11px] text-[#7F8B97] uppercase tracking-wide">Signal Engine — {data.underlying ?? symbol}</div>
      <div className="grid grid-cols-2 gap-1.5 font-mono text-xs">
        {(['gamma','flow','volatility','liquidity','momentum','futures'] as const).map(k => (
          <div key={k} className="flex justify-between bg-[#10151C] border border-[#1C2630] rounded px-2 py-1.5">
            <span className="text-[#7F8B97] capitalize">{k}</span>
            <span className="text-[#E7EDF3]">{renderScore(Number(scores[k] ?? 0))}</span>
          </div>
        ))}
      </div>
      <div className="text-xs text-[#E7EDF3]">Evidence: {data.evidenceCount ?? 0}/10 · Confidence {(Math.round((data.confidence ?? 0)*100))}%</div>
      {Array.isArray(data.evidence) && data.evidence.length > 0 && (
        <ul className="text-[11px] text-[#7F8B97] list-disc list-inside space-y-0.5">
          {data.evidence.slice(0, 8).map((e: string, i: number) => <li key={i}>{e}</li>)}
        </ul>
      )}
    </div>
  );
};

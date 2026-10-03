import React, { useEffect, useState } from 'react';
import { quantApi } from '../../services/quantApi';

export const SimilarDaysPanel: React.FC<{ symbol: string }> = ({ symbol }) => {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    let c = false;
    quantApi.getSimilar(symbol).then(d => { if (!c) setData(d); }).catch(()=>{});
    return () => { c = true; };
  }, [symbol]);
  if (!data) return <div className="p-3 text-xs text-[#7F8B97]">Loading similar days…</div>;
  if (!data.observations?.length) return <div className="p-3 text-xs text-[#7F8B97]">Not enough history yet — need more snapshots.</div>;
  return (
    <div className="p-3 space-y-2">
      <div className="font-mono text-[11px] text-[#7F8B97] uppercase tracking-wide">Historical Intelligence — {data.underlying}</div>
      {data.summary && <div className="text-xs text-[#E7EDF3]">Median next-day {(data.summary.medianNextDayReturn != null ? (data.summary.medianNextDayReturn*100).toFixed(2)+'%' : '—')} · Median range {(data.summary.medianRange != null ? (data.summary.medianRange*100).toFixed(2)+'%' : '—')} · n={data.summary.count}</div>}
      <div className="space-y-1">
        {data.observations.slice(0, 8).map((o: any) => (
          <div key={o.timestamp} className="flex justify-between font-mono text-xs border border-[#1C2630] bg-[#10151C] rounded px-2 py-1">
            <span className="text-[#7F8B97]">{o.date}</span>
            <span className="text-[#E7EDF3]">GEX {o.totals?.gex ?? '—'} · {o.regime}</span>
            <span className={Number(o.nextDayReturn) >= 0 ? 'text-emerald-400' : 'text-red-400'}>{o.nextDayReturn != null ? (o.nextDayReturn*100).toFixed(2)+'%' : '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

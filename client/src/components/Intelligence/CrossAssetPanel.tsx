import React, { useEffect, useState } from 'react';
import { quantApi } from '../../services/quantApi';

export const CrossAssetPanel: React.FC<{ symbol: string }> = ({ symbol }) => {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    let c = false;
    quantApi.getCrossAsset(symbol).then(d => { if (!c) setData(d); }).catch(()=>{});
    const id = setInterval(() => quantApi.getCrossAsset(symbol).then(d => { if (!c) setData(d); }).catch(()=>{}), 30000);
    return () => { c = true; clearInterval(id); };
  }, [symbol]);
  if (!data) return <div className="p-3 text-xs text-[#7F8B97]">Loading cross-asset…</div>;
  return (
    <div className="p-3 space-y-2">
      <div className="font-mono text-[11px] text-[#7F8B97] uppercase tracking-wide">Cross-Asset — {data.underlying}</div>
      <div className="font-mono text-xs grid grid-cols-2 gap-1">
        <div className="bg-[#10151C] border border-[#1C2630] rounded px-2 py-1"><span className="text-[#7F8B97]">SPY GEX</span> <span className="text-[#E7EDF3] float-right">{data.spyGex ?? '—'}</span></div>
        <div className="bg-[#10151C] border border-[#1C2630] rounded px-2 py-1"><span className="text-[#7F8B97]">ES basis</span> <span className="text-[#E7EDF3] float-right">{data.esBasis != null ? data.esBasis.toFixed(2) : '—'}</span></div>
        <div className="bg-[#10151C] border border-[#1C2630] rounded px-2 py-1"><span className="text-[#7F8B97]">NQ basis</span> <span className="text-[#E7EDF3] float-right">{data.nqBasis != null ? data.nqBasis.toFixed(2) : '—'}</span></div>
        <div className="bg-[#10151C] border border-[#1C2630] rounded px-2 py-1"><span className="text-[#7F8B97]">Conflicts</span> <span className="text-[#E7EDF3] float-right">{data.conflicts?.length ?? 0}</span></div>
      </div>
      <div className="text-xs text-[#E7EDF3]">{data.summary}</div>
      {data.conflicts?.length > 0 && <ul className="text-[11px] text-amber-300 list-disc list-inside">{data.conflicts.map((c: string, i: number) => <li key={i}>{c}</li>)}</ul>}
    </div>
  );
};

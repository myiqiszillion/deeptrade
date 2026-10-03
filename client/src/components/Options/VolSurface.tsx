import React, { useEffect, useState } from 'react';
import { quantApi } from '../../services/quantApi';

export const VolSurfacePanel: React.FC<{ symbol: string }> = ({ symbol }) => {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    let c = false;
    quantApi.getVolSurface(symbol).then(d => { if (!c) setData(d); }).catch(()=>{});
    return () => { c = true; };
  }, [symbol]);
  if (!data) return <div className="p-3 text-xs text-[#7F8B97]">Loading vol surface…</div>;
  if (data.empty) return <div className="p-3 text-xs text-[#7F8B97]">{data.reason ?? 'No surface yet.'}</div>;
  return (
    <div className="p-3 space-y-2">
      <div className="font-mono text-[11px] text-[#7F8B97] uppercase tracking-wide">Volatility Surface — {data.underlying}</div>
      {data.diagnostics?.notes?.length > 0 && <div className="text-[11px] text-amber-300">{data.diagnostics.notes.join(' · ')}</div>}
      <div className="font-mono text-xs grid grid-cols-2 gap-1">
        <div className="bg-[#10151C] border border-[#1C2630] rounded px-2 py-1 text-[#7F8B97]">IV spike <span className="float-right text-[#E7EDF3]">{String(data.diagnostics?.ivSpike)}</span></div>
        <div className="bg-[#10151C] border border-[#1C2630] rounded px-2 py-1 text-[#7F8B97]">Skew shift <span className="float-right text-[#E7EDF3]">{String(data.diagnostics?.skewShift)}</span></div>
        <div className="bg-[#10151C] border border-[#1C2630] rounded px-2 py-1 text-[#7F8B97]">Term inverted <span className="float-right text-[#E7EDF3]">{String(data.diagnostics?.termStructureInverted)}</span></div>
        <div className="bg-[#10151C] border border-[#1C2630] rounded px-2 py-1 text-[#7F8B97]">Points <span className="float-right text-[#E7EDF3]">{data.points?.length ?? 0}</span></div>
      </div>
      {Array.isArray(data.termStructure) && data.termStructure.length > 0 && (
        <div className="overflow-auto">
          <table className="w-full font-mono text-[11px] border border-[#1C2630] rounded">
            <thead className="text-[#7F8B97]"><tr><th className="px-2 py-1 text-left">DTE</th><th className="px-2 py-1 text-right">ATM IV</th><th className="px-2 py-1 text-right">Skew</th></tr></thead>
            <tbody>
              {data.termStructure.map((t: any) => {
                const skew = data.skewByExpiry?.find((s: any) => s.dte === t.dte)?.skew;
                return <tr key={t.dte} className="border-t border-[#1C2630]"><td className="px-2 py-1">{t.dte}D</td><td className="px-2 py-1 text-right">{t.atmIv != null ? (t.atmIv*100).toFixed(1)+'%' : '—'}</td><td className="px-2 py-1 text-right">{skew != null ? skew.toFixed(2) : '—'}</td></tr>;
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

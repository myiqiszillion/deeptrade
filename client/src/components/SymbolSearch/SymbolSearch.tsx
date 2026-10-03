import React, { useState } from 'react';

async function getJson(path: string): Promise<any> {
  const token = (() => { try { return localStorage.getItem('deepchart_jwt_token'); } catch { return null; } })();
  const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

export const SymbolSearch: React.FC = () => {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const search = async () => {
    const r = await getJson(`/api/v1/symbols/search?q=${encodeURIComponent(q)}`);
    setResults(r.results ?? []);
  };
  return (
    <div className="p-3 space-y-2">
      <div className="font-mono text-[11px] text-[#7F8B97] uppercase tracking-wide">Symbol Search</div>
      <div className="flex gap-2">
        <input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==='Enter'&&search()} placeholder="SPY" className="flex-1 bg-[#0B0F14] border border-[#1C2630] rounded px-2 py-1.5 font-mono text-xs text-[#E7EDF3]" />
        <button onClick={search} className="px-3 py-1 bg-[#1C2630] text-[#E7EDF3] rounded font-mono text-xs">Search</button>
      </div>
      <div className="space-y-1 max-h-[320px] overflow-auto">
        {results.map((r: any) => (
          <div key={r.instrumentId ?? r.rawSymbol} className="flex justify-between font-mono text-xs border border-[#1C2630] bg-[#10151C] rounded px-2 py-1">
            <span className="text-[#E7EDF3]">{r.rawSymbol ?? r.raw_symbol}</span>
            <span className="text-[#7F8B97]">{r.asset} · {r.exchange}</span>
          </div>
        ))}
        {!results.length && <div className="text-xs text-[#7F8B97]">No results. Try SPY, ES, AAPL.</div>}
      </div>
    </div>
  );
};

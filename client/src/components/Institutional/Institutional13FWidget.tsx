import React, { useState, useEffect } from 'react';
import { Building, RefreshCcw } from 'lucide-react';

interface Institutional13F {
  id: string;
  name: string;
  total_value: number;
  total_companies: number;
  report_date: string;
}

export const Institutional13FWidget: React.FC = () => {
  const [data, setData] = useState<Institutional13F[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch13F = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/market/institutions`);
      if (!res.ok) throw new Error(`API Error: ${res.status}`);
      const json = await res.json();
      if (!json.data) throw new Error('No data received');
      
      setData(json.data.slice(0, 50)); // top 50
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetch13F();
  }, []);

  if (loading && !data) {
    return (
      <div className="w-80 h-full border-l border-brand-border bg-slate-950/40 p-4 text-[#7F8B97] text-center flex flex-col justify-center gap-2 text-xs">
        Loading 13F Data...
      </div>
    );
  }

  if (error || !data || data.length === 0) {
    return (
      <div className="w-80 h-full border-l border-brand-border bg-slate-950/40 p-4 text-[#7F8B97] text-center flex flex-col justify-center items-center gap-3 text-xs">
        <Building size={32} className="text-[#3A4756] mb-1" />
        <div className="flex flex-col gap-1">
          <span className="font-bold text-[#E7EDF3] text-sm">13F UNAVAILABLE</span>
          <span className="text-[11px] leading-relaxed max-w-[220px]">
            {error ? `Error: ${error}` : 'No 13F filings available right now.'}
          </span>
        </div>
        <button onClick={fetch13F} className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-[#1C2630] hover:bg-[#25303A] text-[#E7EDF3] font-medium rounded border border-[#2A2E39] transition-colors">
          <RefreshCcw size={12} /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="w-full h-full border-l border-brand-border bg-slate-950/40 flex flex-col select-none font-mono text-xs">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-2 bg-slate-900/50">
        <div className="flex items-center gap-1.5 font-bold text-slate-200">
          <Building size={14} className="text-[#6366F1]" />
          <span>TOP 13F FUNDS</span>
        </div>
        <span className="text-[9px] px-1.5 py-0.5 bg-[#6366F1]/10 text-[#6366F1] rounded font-bold border border-[#6366F1]/30">
          INSTITUTIONAL
        </span>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto divide-y divide-white/[0.03] text-[10px] custom-scrollbar">
        {data.map((fund) => {
          return (
            <div key={fund.id} className="p-2.5 hover:bg-white/5 space-y-1.5 transition-colors">
              <div className="flex items-center justify-between">
                <span className="font-bold text-[11px] text-[#D1D4DC] truncate max-w-[150px]" title={fund.name}>
                  {fund.name}
                </span>
                <span className="font-bold text-[#10B981]">
                  ${(fund.total_value / 1000000000).toFixed(2)}B
                </span>
              </div>
              
              <div className="flex items-center justify-between text-[#7F8B97]">
                <span>Positions: <b className="text-[#D1D4DC]">{fund.total_companies}</b></span>
                <span>Filed: {fund.report_date}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

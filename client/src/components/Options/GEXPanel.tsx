import React, { useState, useEffect } from 'react';
import { Shield, RefreshCcw } from 'lucide-react';
import { resolveMarketIntelligenceTicker } from '../../services/symbolResolver';

interface GexRow {
  strike: number;
  put_exposure: number;
  call_exposure: number;
  total_exposure: number;
}

interface GEXPanelProps {
  symbol: string;
  currentPrice: number;
}

export const GEXPanel: React.FC<GEXPanelProps> = ({ symbol, currentPrice }) => {
  const [data, setData] = useState<GexRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ticker = resolveMarketIntelligenceTicker(symbol);

  const fetchGex = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/options/chain?symbol=${ticker}`);
      if (!res.ok) throw new Error(`Options API Error: ${res.status}`);
      const json = await res.json();
      if (!json.data && !json.contracts) throw new Error('No data received');
      
      const rows: GexRow[] = json.data || json.contracts || [];
      rows.sort((a, b) => b.strike - a.strike); // descending
      setData(rows);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGex();
  }, [symbol]);

  if (loading && !data) {
    return (
      <div className="w-80 h-full border-l border-brand-border bg-slate-950/40 p-4 text-[#7F8B97] text-center flex flex-col justify-center gap-2 text-xs">
        Loading Databento Options GEX...
      </div>
    );
  }

  if (error || !data || data.length === 0) {
    return (
      <div className="w-80 h-full border-l border-brand-border bg-slate-950/40 p-4 text-[#7F8B97] text-center flex flex-col justify-center items-center gap-3 text-xs">
        <Shield size={32} className="text-[#3A4756] mb-1" />
        <div className="flex flex-col gap-1">
          <span className="font-bold text-[#E7EDF3] text-sm">GEX UNAVAILABLE</span>
          <span className="text-[11px] leading-relaxed max-w-[220px]">
            {error ? `Error: ${error}` : 'No gamma exposure data available for this ticker.'}
          </span>
        </div>
        <button onClick={fetchGex} className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-[#1C2630] hover:bg-[#25303A] text-[#E7EDF3] font-medium rounded border border-[#2A2E39] transition-colors">
          <RefreshCcw size={12} /> Retry
        </button>
      </div>
    );
  }

  // Calculate walls
  let maxCall = 0;
  let callWall = 0;
  let minPut = 0; // put_exposure is negative in UW
  let putWall = 0;
  
  data.forEach(lvl => {
    if (lvl.call_exposure > maxCall) { maxCall = lvl.call_exposure; callWall = lvl.strike; }
    if (lvl.put_exposure < minPut) { minPut = lvl.put_exposure; putWall = lvl.strike; }
  });

  const maxAbsoluteGex = Math.max(
    ...data.map(l => Math.max(Math.abs(l.call_exposure || 0), Math.abs(l.put_exposure || 0)))
  );

  return (
    <div className="w-full h-full flex flex-col select-none font-mono text-xs bg-slate-950/40">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-2 bg-slate-900/50">
        <div className="flex items-center gap-1.5 font-bold text-slate-200">
          <Shield size={14} className="text-[#38BDF8]" />
          <span>GAMMA EXPOSURE</span>
          <span className="text-[9px] px-1 py-0.5 rounded bg-[#38BDF8]/20 text-[#38BDF8] font-normal">
            DATABENTO
          </span>
        </div>
        <span className="text-[10px] px-1.5 py-0.5 bg-white/5 text-[#D1D4DC] rounded font-bold">
          {ticker}
        </span>
      </div>

      {/* GEX Metrics Cards */}
      <div className="p-3 border-b border-white/5 bg-slate-900/80 space-y-2">
        <div className="grid grid-cols-2 gap-1.5 text-[10px] text-center">
          <div className="p-2 bg-[#131722] rounded border border-[#25303A]">
            <div className="text-[#787B86] mb-0.5 font-sans">Put Wall</div>
            <div className="text-[#F43F5E] font-bold text-xs tabular-nums">{putWall}</div>
          </div>
          <div className="p-2 bg-[#131722] rounded border border-[#25303A]">
            <div className="text-[#787B86] mb-0.5 font-sans">Call Wall</div>
            <div className="text-[#10B981] font-bold text-xs tabular-nums">{callWall}</div>
          </div>
        </div>
      </div>

      <p className="px-3 py-2 text-[10px] text-[#7F8B97] font-sans">
        Live spot exposures by strike from Databento OPRA options.
      </p>

      {/* Strike by Strike GEX Distribution */}
      <div className="flex-1 overflow-y-auto divide-y divide-white/[0.03] text-[10px] custom-scrollbar">
        {data.slice(0, 150).map((lvl) => {
          const isCallWall = lvl.strike === callWall;
          const isPutWall = lvl.strike === putWall;
          const callWidth = Math.min(100, (Math.abs(lvl.call_exposure || 0) / (maxAbsoluteGex || 1)) * 100);
          const putWidth = Math.min(100, (Math.abs(lvl.put_exposure || 0) / (maxAbsoluteGex || 1)) * 100);

          return (
            <div key={lvl.strike} className="relative flex items-center justify-between px-3 py-1.5 hover:bg-white/5">
              {/* Put GEX bar (Left) */}
              <div className="w-[35%] h-3.5 bg-black/40 rounded overflow-hidden flex justify-end">
                <div className="bg-[#F43F5E]/60 h-full" style={{ width: `${putWidth}%` }} />
              </div>

              {/* Strike & Badges */}
              <div className="flex items-center gap-1 z-10 mx-2 flex-1 justify-center">
                {isPutWall && <span className="text-[8px] px-1 bg-[#F43F5E]/20 text-[#F43F5E] rounded font-sans">PW</span>}
                <span className={`font-bold ${isCallWall ? 'text-[#10B981]' : isPutWall ? 'text-[#F43F5E]' : 'text-[#D1D4DC]'}`}>
                  {lvl.strike}
                </span>
                {isCallWall && <span className="text-[8px] px-1 bg-[#10B981]/20 text-[#10B981] rounded font-sans">CW</span>}
              </div>

              {/* Call GEX bar (Right) */}
              <div className="w-[35%] h-3.5 bg-black/40 rounded overflow-hidden flex justify-start">
                <div className="bg-[#10B981]/60 h-full" style={{ width: `${callWidth}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

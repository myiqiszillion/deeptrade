import React, { useState, useEffect } from 'react';
import { EyeOff, RefreshCcw } from 'lucide-react';
import { resolveMarketIntelligenceTicker } from '../../services/symbolResolver';

interface BlockTrade {
  id: string;
  ticker_symbol: string;
  price: string;
  size: string;
  premium: string;
  timestamp: string;
  price_diff_from_spot: string | null;
}

interface DarkpoolWidgetProps {
  symbol: string;
}

export const DarkpoolWidget: React.FC<DarkpoolWidgetProps> = ({ symbol }) => {
  const [data, setData] = useState<BlockTrade[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ticker = resolveMarketIntelligenceTicker(symbol);

  const fetchDarkpool = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/options/trades?symbol=${ticker}`);
      if (!res.ok) throw new Error(`Market API Error: ${res.status}`);
      const json = await res.json();
      if (!json.data && !json.trades) throw new Error('No data received');
      
      setData(json.data || json.trades || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDarkpool();
  }, [symbol]);

  if (loading && !data) {
    return (
      <div className="w-80 h-full border-l border-brand-border bg-slate-950/40 p-4 text-[#7F8B97] text-center flex flex-col justify-center gap-2 text-xs">
        Loading Darkpool Prints...
      </div>
    );
  }

  if (error || !data || data.length === 0) {
    return (
      <div className="w-80 h-full border-l border-brand-border bg-slate-950/40 p-4 text-[#7F8B97] text-center flex flex-col justify-center items-center gap-3 text-xs">
        <EyeOff size={32} className="text-[#3A4756] mb-1" />
        <div className="flex flex-col gap-1">
          <span className="font-bold text-[#E7EDF3] text-sm">DARKPOOL UNAVAILABLE</span>
          <span className="text-[11px] leading-relaxed max-w-[220px]">
            {error ? `Error: ${error}` : 'No darkpool prints detected for this ticker today.'}
          </span>
        </div>
        <button onClick={fetchDarkpool} className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-[#1C2630] hover:bg-[#25303A] text-[#E7EDF3] font-medium rounded border border-[#2A2E39] transition-colors">
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
          <EyeOff size={14} className="text-[#A78BFA]" />
          <span>DARKPOOL PRINTS</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] px-1.5 py-0.5 bg-white/5 text-[#D1D4DC] rounded font-bold">
            {ticker}
          </span>
          <span className="text-[9px] px-1.5 py-0.5 bg-[#A78BFA]/10 text-[#A78BFA] rounded font-bold border border-[#A78BFA]/30">
            OFF-EXCHANGE
          </span>
        </div>
      </div>

      {/* Prints List */}
      <div className="flex-1 overflow-y-auto divide-y divide-white/[0.03] text-[10px] custom-scrollbar">
        {data.map((trade) => {
          const premium = parseFloat(trade.premium);
          const price = parseFloat(trade.price);
          
          return (
            <div key={trade.id} className="p-2.5 hover:bg-white/5 space-y-1.5 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-[11px] text-[#A78BFA]">
                    {trade.ticker_symbol}
                  </span>
                  <span className="text-[#D1D4DC] font-bold">${price.toFixed(2)}</span>
                </div>
                <span className="font-bold text-[#E7EDF3]">
                  ${(premium / 1000000).toFixed(2)}M
                </span>
              </div>
              
              <div className="flex items-center justify-between text-[#7F8B97]">
                <div className="flex items-center gap-2">
                  <span>Size: <b className="text-[#D1D4DC]">{parseInt(trade.size).toLocaleString()}</b></span>
                </div>
                <span>{new Date(trade.timestamp).toLocaleTimeString()}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

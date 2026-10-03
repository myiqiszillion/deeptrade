import React, { useState, useEffect } from 'react';
import { Flame, RefreshCcw, ArrowRight } from 'lucide-react';
import { resolveMarketIntelligenceTicker } from '../../services/symbolResolver';

interface OptionFlowAlert {
  id: string;
  ticker_symbol: string;
  strike_price: string;
  option_type: 'Call' | 'Put';
  expiry_date: string;
  premium: string;
  size: string;
  volume: string;
  open_interest: string;
  executed_at: string;
  implied_volatility: string;
  tags?: string[];
}

interface OptionsFlowWidgetProps {
  symbol: string;
}

export const OptionsFlowWidget: React.FC<OptionsFlowWidgetProps> = ({ symbol }) => {
  const [data, setData] = useState<OptionFlowAlert[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ticker = resolveMarketIntelligenceTicker(symbol);

  const fetchFlow = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/options/trades?symbol=${ticker}`);
      if (!res.ok) throw new Error(`Options API Error: ${res.status}`);
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
    fetchFlow();
  }, [symbol]);

  if (loading && !data) {
    return (
      <div className="w-80 h-full border-l border-brand-border bg-slate-950/40 p-4 text-[#7F8B97] text-center flex flex-col justify-center gap-2 text-xs">
        Loading Options Flow...
      </div>
    );
  }

  if (error || !data || data.length === 0) {
    return (
      <div className="w-80 h-full border-l border-brand-border bg-slate-950/40 p-4 text-[#7F8B97] text-center flex flex-col justify-center items-center gap-3 text-xs">
        <Flame size={32} className="text-[#3A4756] mb-1" />
        <div className="flex flex-col gap-1">
          <span className="font-bold text-[#E7EDF3] text-sm">FLOW UNAVAILABLE</span>
          <span className="text-[11px] leading-relaxed max-w-[220px]">
            {error ? `Error: ${error}` : 'No unusual options flow detected for this ticker today.'}
          </span>
        </div>
        <button onClick={fetchFlow} className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-[#1C2630] hover:bg-[#25303A] text-[#E7EDF3] font-medium rounded border border-[#2A2E39] transition-colors">
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
          <Flame size={14} className="text-[#F5B942]" />
          <span>OPTIONS FLOW</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] px-1.5 py-0.5 bg-white/5 text-[#D1D4DC] rounded font-bold">
            {ticker}
          </span>
          <span className="text-[9px] px-1.5 py-0.5 bg-[#F5B942]/10 text-[#F5B942] rounded font-bold border border-[#F5B942]/30">
            INSTITUTIONAL FLOW
          </span>
        </div>
      </div>

      {/* Flow Stream */}
      <div className="flex-1 overflow-y-auto divide-y divide-white/[0.03] text-[10px] custom-scrollbar">
        {data.map((trade) => {
          const isCall = trade.option_type === 'Call';
          const premium = parseFloat(trade.premium);
          const color = isCall ? 'text-[#10B981]' : 'text-[#F43F5E]';
          const bgHover = isCall ? 'hover:bg-[#10B981]/5' : 'hover:bg-[#F43F5E]/5';
          const dte = Math.max(0, Math.floor((new Date(trade.expiry_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)));
          
          return (
            <div key={trade.id} className={`p-2.5 ${bgHover} space-y-1.5 transition-colors`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`font-bold text-[11px] ${color}`}>
                    {trade.ticker_symbol} ${trade.strike_price} {isCall ? 'C' : 'P'}
                  </span>
                  <span className="text-[#7F8B97]">{trade.expiry_date} ({dte}d)</span>
                </div>
                <span className="font-bold text-[#E7EDF3]">
                  ${(premium / 1000).toFixed(1)}k
                </span>
              </div>
              
              <div className="flex items-center justify-between text-[#7F8B97]">
                <div className="flex items-center gap-2">
                  <span>Size: <b className="text-[#D1D4DC]">{trade.size}</b></span>
                  <span>Vol/OI: <b className="text-[#D1D4DC]">{trade.volume}/{trade.open_interest}</b></span>
                </div>
                <span>IV: {Math.round(parseFloat(trade.implied_volatility) * 100)}%</span>
              </div>
              
              {trade.tags && trade.tags.length > 0 && (
                <div className="flex items-center gap-1 mt-1 flex-wrap">
                  {trade.tags.slice(0, 3).map(tag => (
                    <span key={tag} className="px-1 py-0.5 rounded bg-white/5 text-[9px] text-[#A3B1C2]">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

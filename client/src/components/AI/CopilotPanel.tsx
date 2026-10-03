import React, { useState } from 'react';
import { quantApi } from '../../services/quantApi';

export const CopilotPanel: React.FC<{ symbol: string }> = ({ symbol }) => {
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ask = async () => {
    if (!q.trim()) return;
    setLoading(true); setErr(null); setAnswer(null);
    try {
      const r = await quantApi.copilotChat({ message: q, underlying: symbol });
      setAnswer(r.answer ?? JSON.stringify(r, null, 2));
    } catch (e: any) { setErr(String(e)); } finally { setLoading(false); }
  };
  return (
    <div className="p-3 space-y-2">
      <div className="font-mono text-[11px] text-[#7F8B97] uppercase tracking-wide">QuantDecay Copilot — {symbol}</div>
      <div className="flex gap-2">
        <input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter') ask(); }} placeholder="Why did SPY GEX change today?" className="flex-1 bg-[#0B0F14] border border-[#1C2630] rounded px-2 py-1.5 font-mono text-xs text-[#E7EDF3]" />
        <button onClick={ask} disabled={loading} className="px-3 py-1 bg-[#1C2630] text-[#E7EDF3] rounded font-mono text-xs disabled:opacity-50">{loading ? '…' : 'Ask'}</button>
      </div>
      {err && <div className="text-xs text-red-400">{err}</div>}
      {answer && <div className="font-mono text-xs whitespace-pre-wrap bg-[#10151C] border border-[#1C2630] rounded p-2 text-[#E7EDF3]">{answer}</div>}
      <div className="text-[10px] text-[#7F8B97]">Answers cite local QuantDecay state only — no invented prices.</div>
    </div>
  );
};

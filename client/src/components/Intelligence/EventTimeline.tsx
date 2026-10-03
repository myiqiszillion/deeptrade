import React, { useEffect, useState } from 'react';
import { quantApi } from '../../services/quantApi';

export const EventTimeline: React.FC<{ symbol: string }> = ({ symbol }) => {
  const [events, setEvents] = useState<any[]>([]);
  useEffect(() => {
    let c = false;
    const load = () => quantApi.getEvents(symbol).then(d => { if (!c) setEvents(d.events ?? []); }).catch(()=>{});
    load();
    const id = setInterval(load, 15000);
    return () => { c = true; clearInterval(id); };
  }, [symbol]);
  if (!events.length) return <div className="p-3 text-xs text-[#7F8B97]">No events yet.</div>;
  return (
    <div className="p-3 space-y-1">
      <div className="font-mono text-[11px] text-[#7F8B97] uppercase tracking-wide">Event Stream — {symbol}</div>
      <div className="space-y-1 max-h-[320px] overflow-auto pr-1">
        {events.slice(0, 30).map((e: any) => (
          <div key={e.id} className="flex gap-2 font-mono text-xs border-l-2 border-[#1C2630] pl-2 py-1">
            <span className="text-[#7F8B97] shrink-0">{new Date(e.timestamp).toLocaleTimeString()}</span>
            <span className="text-[#E7EDF3]">{e.title}</span>
            <span className="text-[#7F8B97] text-[10px]">{e.kind}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

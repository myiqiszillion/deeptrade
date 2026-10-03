import React, { useEffect, useState } from 'react';

async function getJson(path: string): Promise<any> {
  const token = (() => { try { return localStorage.getItem('deepchart_jwt_token'); } catch { return null; } })();
  const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

export const DataExplorer: React.FC = () => {
  const [datasets, setDatasets] = useState<any[]>([]);
  const [dataset, setDataset] = useState('OPRA.PILLAR');
  const [schema, setSchema] = useState('trades');
  const [date, setDate] = useState(new Date().toISOString().slice(0,10));
  const [files, setFiles] = useState<string[]>([]);
  useEffect(() => { getJson('/api/v1/datasets').then(d => setDatasets(d.datasets ?? [])).catch(()=>{}); }, []);
  const preview = async () => {
    const r = await getJson(`/api/v1/raw/manifest?dataset=${encodeURIComponent(dataset)}&schema=${encodeURIComponent(schema)}&date=${encodeURIComponent(date)}`);
    setFiles(r.files ?? []);
  };
  return (
    <div className="p-3 space-y-2">
      <div className="font-mono text-[11px] text-[#7F8B97] uppercase tracking-wide">Data Explorer</div>
      <div className="grid grid-cols-3 gap-2">
        <select value={dataset} onChange={e=>setDataset(e.target.value)} className="bg-[#0B0F14] border border-[#1C2630] rounded px-2 py-1 font-mono text-xs text-[#E7EDF3]">
          {datasets.map((d: any) => <option key={d.dataset} value={d.dataset}>{d.dataset}</option>)}
          {!datasets.length && <><option value="OPRA.PILLAR">OPRA.PILLAR</option><option value="GLBX.MDP3">GLBX.MDP3</option><option value="DBEQ.BASIC">DBEQ.BASIC</option></>}
        </select>
        <select value={schema} onChange={e=>setSchema(e.target.value)} className="bg-[#0B0F14] border border-[#1C2630] rounded px-2 py-1 font-mono text-xs text-[#E7EDF3]">
          <option value="trades">trades</option><option value="definition">definition</option><option value="ohlcv-1m">ohlcv-1m</option><option value="status">status</option>
        </select>
        <input type="date" value={date} onChange={e=>setDate(e.target.value)} className="bg-[#0B0F14] border border-[#1C2630] rounded px-2 py-1 font-mono text-xs text-[#E7EDF3]" />
      </div>
      <button onClick={preview} className="w-full py-1 bg-[#1C2630] text-[#E7EDF3] rounded font-mono text-xs">Preview</button>
      <div className="space-y-1 font-mono text-xs">
        {files.map(f => <div key={f} className="text-[#7F8B97] truncate">{f}</div>)}
        {!files.length && <div className="text-[#7F8B97]">No files for this partition.</div>}
      </div>
    </div>
  );
};

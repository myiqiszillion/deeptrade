
async function getJson(path: string): Promise<any> {
  const token = (() => { try { return localStorage.getItem('deepchart_jwt_token'); } catch { return null; } })();
  const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}
async function postJson(path: string, body: any): Promise<any> {
  const token = (() => { try { return localStorage.getItem('deepchart_jwt_token'); } catch { return null; } })();
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export const quantApi = {
  getSignals: (sym: string) => getJson(`/api/v1/signals?underlying=${encodeURIComponent(sym)}`),
  getEvents: (sym?: string) => getJson(sym ? `/api/v1/events?underlying=${encodeURIComponent(sym)}` : '/api/v1/events'),
  getSimilar: (sym: string) => getJson(`/api/v1/intelligence/similar?underlying=${encodeURIComponent(sym)}`),
  getCrossAsset: (sym: string) => getJson(`/api/v1/cross-asset?underlying=${encodeURIComponent(sym)}`),
  getVolSurface: (sym: string) => getJson(`/api/v1/vol-surface?underlying=${encodeURIComponent(sym)}`),
  getDealerImpact: (sym: string) => getJson(`/api/v1/dealer-impact?underlying=${encodeURIComponent(sym)}`),
  getMicrostructure: (sym: string) => getJson(`/api/v1/microstructure?symbol=${encodeURIComponent(sym)}`),
  getMarketState: (sym: string) => getJson(`/api/v1/ai/market-state?underlying=${encodeURIComponent(sym)}`),
  runBacktest: (body: any) => postJson('/api/v1/research/backtest', body),
  queryLab: (body: any) => postJson('/api/v1/research/query', body),
  copilotChat: (body: any) => postJson('/api/v1/ai/copilot/chat', body),
};

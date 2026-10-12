import { useEffect, useState } from 'react';

type Snapshot = { bars: { volume: number; buyVolume: number; sellVolume: number; cvd: number; open: number; high: number; low: number; close: number }[]; profile: { totalVolume: number; coverage: string; levels: unknown[] } };
type Evidence = { type: string; symbol: string; instrumentId: number; resolvedContract: string; dataset: string; schema: string; sessionId: string; source: string; final: boolean; watermark: number; acceptedVolume: number; unknownVolume: number; signedContributions: number[]; digest: string; state: string; reason: string; snapshot: Snapshot };

/** Observer only: never sends SUBSCRIBE, START, history requests, or reconnects. */
export default function AcceptanceObserver() {
  const [evidence, setEvidence] = useState<Evidence>();
  const [socket, setSocket] = useState<WebSocket>();
  const [error, setError] = useState('');
  useEffect(() => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/acceptance-observer`);
    let session: string | undefined;
    let instrument: number | undefined;
    ws.onmessage = event => {
      const msg = JSON.parse(event.data) as Evidence;
      if (msg.type !== 'ACCEPTANCE' || msg.symbol !== 'ES' || msg.dataset !== 'GLBX.MDP3' || msg.schema !== 'trades' || (session && session !== msg.sessionId) || (instrument && instrument !== msg.instrumentId)) { setError('Cohort mismatch'); return; }
      session = msg.sessionId; instrument = msg.instrumentId; setEvidence(msg);
    };
    ws.onerror = () => setError('Observer unavailable');
    setSocket(ws); return () => ws.close();
  }, []);
  useEffect(() => {
    if (!evidence || !socket) return;
    let active = true;
    const bytes = new TextEncoder().encode(JSON.stringify(evidence.snapshot));
    void crypto.subtle.digest('SHA-256', bytes).then(result => {
      if (!active || socket.readyState !== WebSocket.OPEN) return;
      const digest = Array.from(new Uint8Array(result), b => b.toString(16).padStart(2, '0')).join('');
      const bars = evidence.snapshot.bars;
      const volume = bars.reduce((n, b) => n + b.volume, 0);
      const buy = bars.reduce((n, b) => n + b.buyVolume, 0);
      const sell = bars.reduce((n, b) => n + b.sellVolume, 0);
      const cvd = bars.at(-1)?.cvd ?? 0;
      const ok = digest === evidence.digest && volume === evidence.acceptedVolume &&
        evidence.snapshot.profile.totalVolume === volume && volume - buy - sell === evidence.unknownVolume &&
        cvd === evidence.signedContributions.reduce((n, v) => n + v, 0);
      socket.send(JSON.stringify({ type: 'RECEIPT', sessionId: evidence.sessionId, watermark: evidence.watermark,
        final: evidence.final, digest, volume, buy, sell, unknown: volume - buy - sell, cvd, ok }));
      if (!ok) setError('Numeric reconciliation failed');
    });
    return () => { active = false; };
  }, [evidence, socket]);
  return <main style={{ padding: 24 }} data-testid="acceptance-observer">
    <h1>Controlled Trades acceptance observer</h1>
    <p>{evidence?.source ?? 'Waiting for local operator'} — {evidence?.state} — {evidence?.reason}</p>
    <p>Vendor disconnected after CLOSED/FAILED; WebSocket receipt is separate from vendor connectivity.</p>
    <p>Coverage PARTIAL — observed window only. UNKNOWN contributes zero to CVD.</p>
    <p data-testid="acceptance-watermark">Records: {evidence?.watermark ?? 0}</p>
    <p data-testid="acceptance-volume">Volume: {evidence?.acceptedVolume ?? 0}; UNKNOWN: {evidence?.unknownVolume ?? 0}</p>
    <p role="alert">{error}</p>
    <pre data-testid="acceptance-snapshot">{JSON.stringify(evidence?.snapshot, null, 2)}</pre>
  </main>;
}

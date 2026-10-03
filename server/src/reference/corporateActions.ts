export interface CorporateAction { symbol: string; type: 'split'|'dividend'|'symbol_change'|'merger'|'spinoff'; date: string; ratio?: number; amount?: number; }
export function adjustForCorporateActions(bars: any[], actions: CorporateAction[]): any[] {
  if (!actions.length) return bars;
  // Backward adjust: walk actions in reverse, multiply prices before action date
  let adjusted = [...bars];
  for (const a of [...actions].reverse()) {
    if (a.type === 'split' && a.ratio) {
      const ts = new Date(a.date).getTime();
      adjusted = adjusted.map(b => b.time < ts ? { ...b, open: b.open / a.ratio!, high: b.high / a.ratio!, low: b.low / a.ratio!, close: b.close / a.ratio!, volume: b.volume * a.ratio! } : b);
    }
  }
  return adjusted;
}

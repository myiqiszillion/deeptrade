/**
 * Copilot router: tool-calling stub. Without LLM key, returns deterministic summary
 * from market state + supports the UI chat flow. With OPENAI_API_KEY / ANTHROPIC_API_KEY,
 * a real LLM pass can be wired here without changing the API shape.
 */
import { IncomingMessage, ServerResponse } from 'http';
import { buildMarketState } from './marketState.js';
import { findSimilarDays } from '../intelligence/historicalIntelligence.js';

function summarize(state: any): string {
  const lines: string[] = [];
  lines.push(`**${state.symbol}** spot ${state.spot ?? '—'}.`);
  if (state.snapshot?.regime) lines.push(`Regime: ${state.snapshot.regime}, GEX ${state.snapshot.totals?.gex ?? '—'}.`);
  if (state.signals) lines.push(`Signals: Gamma ${state.signals.scores?.gamma ?? '—'}, Flow ${state.signals.scores?.flow ?? '—'}, Confidence ${(state.signals.confidence ?? 0 * 100).toFixed?.(0) ?? '—'}%. Evidence: ${(state.signals.evidence ?? []).join('; ') || 'none'}.`);
  if (state.crossAsset?.conflicts?.length) lines.push(`Cross-asset: ${state.crossAsset.conflicts.join('; ')}`);
  if (state.events?.length) lines.push(`Recent events: ${state.events.slice(0, 3).map((e: any) => e.title).join(' · ')}`);
  lines.push('_Sources: local snapshot, exposure, microstructure and event store — no vendor fetch._');
  return lines.join('\n\n');
}

export function createCopilotRouter() {
  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    if (!url.pathname.startsWith('/api/v1/ai/copilot')) return false;
    const send = (status: number, data: any) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); return true; };
    if (req.method !== 'POST') return send(405, { error: 'Use POST { message, underlying? }' });
    let raw = ''; await new Promise<void>(r => { req.on('data', (c: any) => raw += c); req.on('end', () => r()); req.on('error', () => r()); });
    let body: any = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { return send(400, { error: 'Invalid JSON' }); }
    const underlying = String(body.underlying || body.symbol || 'SPY').toUpperCase();
    const message: string = String(body.message || body.prompt || '').slice(0, 4000);
    const state = buildMarketState(underlying);

    // Light intent routing without LLM
    const lower = message.toLowerCase();
    let extra: any = {};
    if (lower.includes('similar') || lower.includes('từng xảy ra') || lower.includes('history')) {
      extra.similar = findSimilarDays(underlying, 5);
    }

    const answer = summarize(state);
    // If LLM key present, this is where a streaming call would be inserted (kept stub for now to avoid new deps)
    return send(200, {
      underlying,
      message: message || '(empty prompt — showing market state summary)',
      answer,
      marketState: state,
      extra,
      disclaimer: 'Deterministic summary from local QuantDecay state. Wire OPENAI_API_KEY/ANTHROPIC_API_KEY for generative reasoning.',
    });
  };
}

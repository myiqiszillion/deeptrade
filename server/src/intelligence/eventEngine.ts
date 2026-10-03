/** Append-only event stream derived from detectors (flow, GEX, IV, microstructure). */
export type QuantEventKind = 'LARGE_FLOW' | 'VOLUME_SPIKE' | 'GAMMA_FLIP' | 'IV_EXPANSION' | 'LIQUIDITY_IMBALANCE' | 'GEX_WALL_TOUCH';

export interface QuantEvent {
  id: string;
  timestamp: number;
  underlying: string;
  kind: QuantEventKind;
  title: string;
  detail?: string;
  meta?: Record<string, unknown>;
}

const MAX_EVENTS = 500;
const ring: QuantEvent[] = [];

export function emitEvent(e: Omit<QuantEvent, 'id'>): QuantEvent {
  const ev: QuantEvent = { ...e, id: `${e.kind}_${e.timestamp}_${Math.random().toString(36).slice(2, 6)}` };
  ring.push(ev);
  if (ring.length > MAX_EVENTS) ring.shift();
  return ev;
}

export function listEvents(underlying?: string, limit = 100): QuantEvent[] {
  const u = underlying?.toUpperCase();
  const filtered = u ? ring.filter(e => e.underlying === u) : ring;
  return filtered.slice(-limit).reverse();
}

export function clearEvents() { ring.length = 0; }

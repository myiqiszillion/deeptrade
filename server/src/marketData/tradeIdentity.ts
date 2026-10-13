import { randomUUID } from 'node:crypto';
import type { Tick } from '../types.js';

/** A record-equivalence identity, NOT an exchange execution ID or symbol-local sequence. */
export type VendorTradeIdentity = readonly [
  dataset: string, publisherId: number, instrumentId: number, eventNs: string,
  priceRaw: string, size: number, action: string, side: string, flags: number,
  depth: number, vendorReceiveNs: string, tsInDelta: number, venueSequence: number
];
const PREFIX = 'dbn-trades-v1:';
export function exactNs(value: unknown): string | undefined {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return undefined;
  if (typeof value === 'bigint' || (typeof value === 'number' && Number.isSafeInteger(value)) || (typeof value === 'string' && /^\d+$/.test(value))) {
    try { const n = BigInt(value); return n >= 0n && n <= 18446744073709551615n ? String(n) : undefined; } catch { return undefined; }
  }
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)$/);
    if (m) { const seconds = Date.parse(m[1] + m[3]); if (Number.isFinite(seconds) && seconds >= 0) return String(BigInt(seconds) * 1000000n + BigInt((m[2] || '').padEnd(9, '0'))); }
  }
  return undefined;
}
function valid(r: readonly unknown[]): r is VendorTradeIdentity {
  const u = (v: unknown, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
  return r.length === 13 && typeof r[0] === 'string' && /^[A-Z0-9_.-]{1,80}$/.test(r[0]) &&
    u(r[1], 65535) && u(r[2], 4294967295) && typeof r[3] === 'string' && exactNs(r[3]) === r[3] &&
    typeof r[4] === 'string' && /^\d+$/.test(r[4]) && BigInt(r[4]) > 0n && BigInt(r[4]) < 9223372036854775807n &&
    u(r[5], 4294967294) && r[6] === 'T' && typeof r[7] === 'string' && r[7].length === 1 &&
    u(r[8], 255) && u(r[9], 255) && typeof r[10] === 'string' && exactNs(r[10]) === r[10] &&
    typeof r[11] === 'number' && Number.isInteger(r[11]) && r[11] >= -2147483648 && r[11] <= 2147483647 && u(r[12], 4294967295);
}
export function vendorTradeId(record: VendorTradeIdentity): string {
  if (!valid(record)) throw new Error('Invalid vendor trade identity metadata');
  // Lossless canonical payload inside the existing TEXT primary key; no SQLite migration or digest collisions.
  return PREFIX + record[3].padStart(20, '0') + ':' + Buffer.from(JSON.stringify(record)).toString('base64url');
}
/** JSON pretty-price is canonicalized exactly; unsafe numeric nanoseconds never get fabricated. */
export function identityFromJson(rec: any, dataset?: string): VendorTradeIdentity | undefined {
  if (!dataset) return undefined;
  const event = exactNs(rec.ts_event ?? rec.hd?.ts_event), receive = exactNs(rec.ts_recv);
  if (event === undefined || receive === undefined) return undefined;
  let rawPrice: string;
  try {
    if (typeof rec.price === 'number' && !Number.isSafeInteger(rec.price) && Math.abs(rec.price) >= 100000000) return undefined;
    const value = String(rec.price);
    if (/^\d+$/.test(value) && BigInt(value) >= 100000000n) rawPrice = BigInt(value).toString();
    else {
      const m = value.match(/^(\d+)(?:\.(\d{1,9}))?$/);
      if (!m) return undefined;
      rawPrice = String(BigInt(m[1]) * 1000000000n + BigInt((m[2] || '').padEnd(9, '0')));
    }
  } catch { return undefined; }
  const r = [dataset, rec.publisher_id ?? rec.hd?.publisher_id, rec.instrument_id ?? rec.hd?.instrument_id,
    event, rawPrice, rec.size, rec.action, rec.side, rec.flags, rec.depth, receive, rec.ts_in_delta, rec.sequence];
  return valid(r) ? Object.freeze(r) : undefined;
}
export function identityFromId(id: string): VendorTradeIdentity | undefined {
  if (!id.startsWith(PREFIX)) return undefined;
  try {
    if (id.length > 2048) throw new Error();
    const r = JSON.parse(Buffer.from(id.slice(PREFIX.length + 21), 'base64url').toString('utf8'));
    if (!Array.isArray(r) || !valid(r) || vendorTradeId(r) !== id) throw new Error();
    return Object.freeze(r);
  } catch { throw new Error('Malformed reserved vendor trade identity'); }
}
export function identityFields(id: string) {
  const vendorIdentity = identityFromId(id);
  if (vendorIdentity) return { vendorIdentity, eventTsNs: vendorIdentity[3], identityKind: 'VENDOR_RECORD_V1' as const };
  if (id.startsWith('local-trade-v1:')) {
    const encoded = id.split(':')[2];
    if (encoded) {
      const eventTsNs = Buffer.from(encoded, 'base64url').toString('utf8');
      if (exactNs(eventTsNs) !== eventTsNs) throw new Error('Malformed local trade precision metadata');
      return { eventTsNs, identityKind: 'LOCAL_DELIVERY_V1' as const };
    }
    return { identityKind: 'LOCAL_DELIVERY_V1' as const };
  }
  return { identityKind: 'LEGACY' as const };
}
export function resolveTradeIdentity(t: { id?: string; ts?: number; timestamp?: number; price: number; size: number; side: string; vendorIdentity?: VendorTradeIdentity; eventTsNs?: string }) {
  const r = t.vendorIdentity || (t.id ? identityFromId(t.id) : undefined);
  if (r) {
    const id = vendorTradeId(r);
    const expectedSide = r[7] === 'B' ? 'buy' : r[7] === 'A' ? 'sell' : 'unknown';
    if ((t.id && t.id !== id) || (t.ts ?? t.timestamp) !== Number(BigInt(r[3]) / 1000000n) ||
        t.price !== Number(BigInt(r[4])) / 1e9 || t.size !== r[5] || t.side.toLowerCase() !== expectedSide ||
        (t.eventTsNs !== undefined && t.eventTsNs !== r[3])) throw new Error('Vendor trade identity/payload conflict');
    return { id, vendorIdentity: r, eventTsNs: r[3], identityKind: 'VENDOR_RECORD_V1' as const };
  }
  if (t.eventTsNs !== undefined && (exactNs(t.eventTsNs) !== t.eventTsNs || Number(BigInt(t.eventTsNs) / 1000000n) !== (t.ts ?? t.timestamp))) throw new Error('Partial event timestamp precision conflict');
  const id = t.id || `local-trade-v1:${randomUUID()}${t.eventTsNs === undefined ? '' : ':' + Buffer.from(t.eventTsNs).toString('base64url')}`;
  return { id, ...identityFields(id) };
}

/** Duplicate overlap is removed at loading boundaries, before analytics process a cohort. */
export function uniqueTradeTicks(ticks: Tick[]): Tick[] {
  const byId = new Map<string, Tick>();
  for (const input of ticks) {
    const t = { ...input, ...resolveTradeIdentity(input) };
    const previous = byId.get(t.id);
    if (previous && (previous.timestamp !== t.timestamp || previous.price !== t.price || previous.size !== t.size || previous.side !== t.side)) throw new Error('Replay/history identity conflict; reconciliation required');
    if (!previous) byId.set(t.id, t);
  }
  return [...byId.values()].sort((a, b) => a.timestamp - b.timestamp ||
    (a.eventTsNs && b.eventTsNs && a.eventTsNs !== b.eventTsNs ? (BigInt(a.eventTsNs) < BigInt(b.eventTsNs) ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

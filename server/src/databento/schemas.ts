/**
 * Lightweight runtime validators for Databento HTTP responses.
 * Keeps the client free of a zod dependency; shapes are narrow and fail-closed.
 */

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function validateOhlcvRecord(r: unknown): boolean {
  if (!isRecord(r)) return false;
  return (
    (typeof r.open === 'number' || typeof r.open === 'string') &&
    (typeof r.close === 'number' || typeof r.close === 'string') &&
    typeof r.volume === 'number'
  );
}

export function validateTradeRecord(r: unknown): boolean {
  if (!isRecord(r)) return false;
  return (typeof r.price === 'number' || typeof r.price === 'string') && typeof r.size === 'number';
}

export function validateDefinitionRecord(r: unknown): boolean {
  if (!isRecord(r)) return false;
  return typeof r.raw_symbol === 'string' && typeof r.instrument_id === 'number';
}

/** OSI symbology: e.g. SPY  260306C00700000 — strict, rejects malformed strikes. */
const OSI_RE = /^([A-Z]{1,6})\s*(\d{6})([CP])(\d{8})$/;

export function isValidOsiSymbol(sym: string): boolean {
  return OSI_RE.test(sym.trim().replace(/\s+/g, ''));
}

export function parseOsiStrict(
  sym: string,
): { underlying: string; expiry: string; type: 'call' | 'put'; strike: number } | null {
  const normalized = sym.trim().replace(/\s+/g, '');
  const m = normalized.match(/^([A-Z]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  if (!m) return null;
  const [, underlying, yy, mm, dd, cp, strikeRaw] = m;
  const year = 2000 + parseInt(yy, 10);
  const expiry = `${year}-${mm}-${dd}`;
  const strike = parseInt(strikeRaw, 10) / 1000;
  if (!Number.isFinite(strike) || strike <= 0) return null;
  return { underlying, expiry, type: cp === 'C' ? 'call' : 'put', strike };
}

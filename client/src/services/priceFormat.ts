/**
 * Client-side mirror of the server's tick maths (server/src/priceMath.ts).
 * Futures tick sizes differ by instrument (ES 0.25, RTY/GC 0.1, CL 0.01, NG 0.001, YM 1),
 * so hardcoding `toFixed(1)` misrepresents most of them.
 */

/** Decimal places implied by a tick size (1 -> 0, 0.25 -> 2, 0.01 -> 2, 0.001 -> 3). */
export function decimalsForTick(tickSize: number): number {
  if (!Number.isFinite(tickSize) || tickSize <= 0) return 2;
  const text = tickSize.toString();
  if (text.includes('e-')) {
    const [mantissa, exponent] = text.split('e-');
    const mantissaDecimals = mantissa.includes('.') ? mantissa.split('.')[1].length : 0;
    return mantissaDecimals + Number(exponent);
  }
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

/** Format a price at the instrument's own precision. */
export function formatPrice(value: number | undefined | null, tickSize = 0.25): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '—';
  return value.toFixed(decimalsForTick(tickSize));
}

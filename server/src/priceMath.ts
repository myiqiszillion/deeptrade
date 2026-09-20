/**
 * Shared price-grid helpers for the orderflow engines.
 *
 * Futures tick sizes such as 0.1 (GC/RTY) and 0.01 (CL) do not divide IEEE-754 doubles
 * cleanly: `Math.round(5850.1 / 0.1) * 0.1` yields 5850.1000000000004. That drift leaks
 * into footprint level keys, JSON payloads and the DOM ladder, so every price is snapped
 * back to the tick's own decimal precision.
 */

/** Decimal places implied by a tick size (1 -> 0, 0.25 -> 2, 0.01 -> 2, 0.001 -> 3). */
export function tickDecimals(tickSize: number): number {
  if (!Number.isFinite(tickSize) || tickSize <= 0) return 0;
  const text = tickSize.toString();
  if (text.includes('e-')) {
    const [mantissa, exponent] = text.split('e-');
    const mantissaDecimals = mantissa.includes('.') ? mantissa.split('.')[1].length : 0;
    return mantissaDecimals + Number(exponent);
  }
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

/** Snap a price onto the instrument's tick grid without floating point residue. */
export function normalizeToTick(price: number, tickSize: number): number {
  if (!Number.isFinite(price) || !Number.isFinite(tickSize) || tickSize <= 0) return price;
  return Number((Math.round(price / tickSize) * tickSize).toFixed(tickDecimals(tickSize)));
}

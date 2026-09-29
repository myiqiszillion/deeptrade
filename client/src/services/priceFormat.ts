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

/** Format a volume or delta number compactly (e.g. 18, 40, 84, 126, +80 Δ, 1.2K, 15K, 1.5M). */
export function formatVolume(val: number | undefined | null): string {
  if (val === undefined || val === null || !Number.isFinite(val)) return '—';
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';

  if (abs >= 1_000_000) {
    const m = abs / 1_000_000;
    const str = m.toFixed(1).replace(/\.0$/, '');
    return `${sign}${str}M`;
  }
  if (abs >= 10_000) {
    return `${sign}${Math.round(abs / 1_000)}K`;
  }
  if (abs >= 1_000) {
    const k = abs / 1_000;
    const str = k.toFixed(1).replace(/\.0$/, '');
    return `${sign}${str}K`;
  }
  // For values < 1000:
  // If effectively an integer, render directly as integer without trailing decimals
  if (Math.abs(abs - Math.round(abs)) < 0.001) {
    return `${sign}${Math.round(abs)}`;
  }
  // Otherwise up to 1 decimal place, stripping trailing zeros
  return `${sign}${abs.toFixed(1).replace(/\.0$/, '')}`;
}

/**
 * Pure functions for viewport coordinate transformations and layout calculations.
 */
import { decimalsForTick } from './priceFormat';

export function calculatePriceToY(
  price: number,
  anchorPrice: number,
  panY: number,
  priceScale: number,
  tickSize: number
): number {
  const priceDiff = price - anchorPrice;
  const ticks = priceDiff / tickSize;
  return panY - ticks * priceScale;
}

export function calculateYToPrice(
  y: number,
  anchorPrice: number,
  panY: number,
  priceScale: number,
  tickSize: number
): number {
  const diffY = panY - y;
  const ticks = diffY / priceScale;
  const price = anchorPrice + ticks * tickSize;
  // Snap onto the tick grid AND the tick's own decimal precision: `Math.round(p / tick) * tick`
  // alone reintroduces IEEE-754 residue (0.1 -> 5850.1000000000004), which would leak into the
  // crosshair price readout. Same rule as the server's `normalizeToTick`.
  if (!Number.isFinite(price) || !Number.isFinite(tickSize) || tickSize <= 0) return price;
  return Number((Math.round(price / tickSize) * tickSize).toFixed(decimalsForTick(tickSize)));
}

export function clampScale(
  currentScale: number,
  factor: number,
  min: number,
  max: number
): number {
  return Math.max(min, Math.min(max, currentScale * factor));
}

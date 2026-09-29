/**
 * Pure functions for viewport coordinate transformations and layout calculations.
 */

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
  return Math.round((anchorPrice + ticks * tickSize) / tickSize) * tickSize;
}

export function calculateAutoFollowPanX(
  canvasWidth: number,
  barCount: number,
  barWidth: number,
  barSpacing: number,
  rightMargin = 80
): number {
  const totalWidth = barCount * (barWidth + barSpacing);
  return canvasWidth - totalWidth - rightMargin;
}

export function clampScale(
  currentScale: number,
  factor: number,
  min: number,
  max: number
): number {
  return Math.max(min, Math.min(max, currentScale * factor));
}

/**
 * Computes a human-friendly price step for grid lines and axis ticks,
 * adapting to the current price scale and instrument tick size.
 */
export function getNicePriceStep(
  tickSize: number,
  priceScale: number,
  targetSpacingPx = 45
): number {
  if (priceScale <= 0 || tickSize <= 0) return Math.max(0.01, tickSize * 4);
  const rawSpan = (targetSpacingPx / priceScale) * tickSize;
  const power = Math.pow(10, Math.floor(Math.log10(Math.max(1e-6, rawSpan))));
  const fraction = rawSpan / power;
  let niceMultiplier = 1;
  if (fraction >= 7) niceMultiplier = 10;
  else if (fraction >= 3.5) niceMultiplier = 5;
  else if (fraction >= 1.8) niceMultiplier = 2;
  else niceMultiplier = 1;

  const niceStep = niceMultiplier * power;
  return Math.max(tickSize, Math.round(niceStep / tickSize) * tickSize);
}

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

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

/**
 * Maps a timestamp to a bar index in barsList.
 * Returns -1 if the timestamp is strictly before the first bar or strictly after the last bar's duration.
 * Never snaps out-of-range timestamps to bar 0 or last bar.
 */
export function findBarIndexByTime(time: number, barsList: Array<{ time: number }>): number {
  if (!barsList || barsList.length === 0) return -1;
  const barInterval = barsList.length >= 2 ? Math.max(1000, barsList[1].time - barsList[0].time) : 60000;
  const earliest = barsList[0].time;
  const latest = barsList[barsList.length - 1].time + barInterval;
  if (time < earliest || time >= latest) return -1;

  for (let i = 0; i < barsList.length; i++) {
    const nextTime = i < barsList.length - 1 ? barsList[i + 1].time : (barsList[i].time + barInterval);
    if (time >= barsList[i].time && time < nextTime) {
      return i;
    }
  }
  return -1;
}


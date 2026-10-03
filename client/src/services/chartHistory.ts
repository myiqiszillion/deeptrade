export const historyBeforeLive = <T extends { time: number }>(history: T[], live: { time: number }[]): T[] => {
  if (!history || history.length === 0) return [];
  if (!live || live.length === 0) {
    const byTime = new Map(history.map((bar) => [bar.time, bar]));
    return [...byTime.values()].sort((a, b) => a.time - b.time);
  }

  // Keep the series disjoint by TIME, but only consider live bars that fall within or after the historical series window.
  // Stale or archived ticks that pre-date the history window must not truncate the real candle series.
  const oldestHistoryTime = history[0]?.time ?? 0;
  const relevantLiveTimes = live.map((bar) => bar.time).filter((t) => t >= oldestHistoryTime);

  const firstLiveTime = relevantLiveTimes.length > 0 ? Math.min(...relevantLiveTimes) : Infinity;
  const byTime = new Map(history.filter((bar) => bar.time < firstLiveTime).map((bar) => [bar.time, bar]));
  return [...byTime.values()].sort((a, b) => a.time - b.time);
};

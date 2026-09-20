export const historyBeforeLive = <T extends { time: number }>(history: T[], live: { time: number }[]): T[] => {
  // Keep the series disjoint by TIME, not just by drawing it at negative indices.
  const firstLiveTime = live.length > 0 ? Math.min(...live.map((bar) => bar.time)) : Infinity;
  const byTime = new Map(history.filter((bar) => bar.time < firstLiveTime).map((bar) => [bar.time, bar]));
  return [...byTime.values()].sort((a, b) => a.time - b.time);
};

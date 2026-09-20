import React from 'react';

type Tone = 'live' | 'delayed' | 'none';

interface DataStatusStripProps {
  symbol: string;
  isCrypto: boolean;
  /** Server-reported feed state for this instrument ('LIVE' only after validated data). */
  feedStatus?: 'LIVE' | 'UNAVAILABLE';
  historySource: 'NONE' | 'REAL_TICKS' | 'REAL_BARS';
  gexSource?: 'CBOE_DELAYED' | 'LIVE';
}

const TONES: Record<Tone, string> = {
  live: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  delayed: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  none: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
};

const Chip: React.FC<{ label: string; value: string; tone: Tone; title?: string }> = ({ label, value, tone, title }) => (
  <span title={title} className={`px-1.5 py-0.5 rounded border text-[9px] font-mono whitespace-nowrap ${TONES[tone]}`}>
    {label}: {value}
  </span>
);

/**
 * Single source of truth for data provenance. DeepChart is real-only: every channel is
 * either realtime, real-but-delayed, or UNAVAILABLE. Nothing is ever simulated.
 *
 * FEED reports the SERVER's feed state rather than a per-instrument guess, so a licensed
 * futures vendor streaming live data is no longer mislabelled UNAVAILABLE.
 */
export const DataStatusStrip: React.FC<DataStatusStripProps> = ({
  symbol,
  isCrypto,
  feedStatus,
  historySource,
  gexSource,
}) => (
  <div className="flex items-center gap-1.5">
    <Chip
      label="FEED"
      value={feedStatus === 'LIVE' ? 'REALTIME' : 'UNAVAILABLE'}
      tone={feedStatus === 'LIVE' ? 'live' : 'none'}
      title={
        feedStatus === 'LIVE'
          ? isCrypto
            ? 'Real-time Binance Futures trades + depth'
            : 'Real-time licensed vendor feed (validated market data)'
          : isCrypto
            ? 'Binance stream unavailable'
            : 'Real-time vendor feed unavailable (configuration, entitlement or connection)'
      }
    />
    <Chip
      label="HISTORY"
      value={historySource === 'REAL_TICKS' ? 'REAL TICKS' : historySource === 'REAL_BARS' ? 'REAL BARS' : 'NONE'}
      tone={historySource === 'NONE' ? 'none' : 'delayed'}
      title={
        historySource === 'REAL_TICKS'
          ? 'Seeded with real historical trades - full footprint'
          : historySource === 'REAL_BARS'
            ? 'Real vendor bars before the live session - plain candles, no per-price footprint'
            : 'No real history source - the chart accumulates live ticks only'
      }
    />
    <Chip
      label="GEX"
      value={gexSource === 'CBOE_DELAYED' ? 'REAL DELAYED' : gexSource === 'LIVE' ? 'REAL LIVE' : 'UNAVAILABLE'}
      tone={gexSource === 'CBOE_DELAYED' ? 'delayed' : gexSource === 'LIVE' ? 'live' : 'none'}
      title={gexSource ? 'Computed from a real option chain' : 'CBOE chain unreachable - no synthetic fallback'}
    />
    <Chip label="FLOW" value="UNAVAILABLE" tone="none" title="No real options-flow provider is configured" />
    <span className="text-[9px] text-slate-500 hidden 2xl:inline">
      - {symbol} - educational use only, not investment advice
    </span>
  </div>
);

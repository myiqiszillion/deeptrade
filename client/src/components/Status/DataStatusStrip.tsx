import React from 'react';

type Tone = 'live' | 'delayed' | 'none';

interface DataStatusStripProps {
  symbol: string;
  isCrypto: boolean;
  historySource: 'NONE' | 'REAL_TICKS';
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
 */
export const DataStatusStrip: React.FC<DataStatusStripProps> = ({ symbol, isCrypto, historySource, gexSource }) => (
  <div className="flex items-center gap-1.5">
    <Chip
      label="FEED"
      value={isCrypto ? 'REALTIME' : 'UNAVAILABLE'}
      tone={isCrypto ? 'live' : 'none'}
      title={
        isCrypto
          ? 'Real-time Binance Futures trades + depth'
          : 'No licensed real-time vendor is configured for this instrument'
      }
    />
    <Chip
      label="HISTORY"
      value={historySource === 'REAL_TICKS' ? 'REAL' : 'NONE'}
      tone={historySource === 'REAL_TICKS' ? 'delayed' : 'none'}
      title={
        historySource === 'REAL_TICKS'
          ? 'Seeded with real historical trades'
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

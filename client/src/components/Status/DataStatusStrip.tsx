import React from 'react';

type Tone = 'live' | 'delayed' | 'sim' | 'none';

interface DataStatusStripProps {
  symbol: string;
  isCrypto: boolean;
  historySource: 'NONE' | 'REAL_TICKS' | 'RECONSTRUCTED_1M';
  gexSource?: 'SIMULATED' | 'LIVE' | 'CBOE_DELAYED';
}

const TONES: Record<Tone, string> = {
  live: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  delayed: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  sim: 'bg-slate-700/50 text-slate-300 border-slate-600/60',
  none: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
};

const Chip: React.FC<{ label: string; value: string; tone: Tone; title?: string }> = ({ label, value, tone, title }) => (
  <span title={title} className={`px-1.5 py-0.5 rounded border text-[9px] font-mono whitespace-nowrap ${TONES[tone]}`}>
    {label}: {value}
  </span>
);

/**
 * Compact provenance strip. DeepChart mixes real, delayed and synthetic sources, so the
 * user should never have to guess which one they are trading off.
 */
export const DataStatusStrip: React.FC<DataStatusStripProps> = ({ symbol, isCrypto, historySource, gexSource }) => (
  <div className="flex items-center gap-1.5">
    <Chip
      label="FEED"
      value={isCrypto ? 'LIVE BINANCE' : 'SIM CME'}
      tone={isCrypto ? 'live' : 'sim'}
      title={isCrypto ? 'Real-time Binance Futures trades + depth' : 'Modelled CME Globex ticks + depth'}
    />
    <Chip
      label="HISTORY"
      value={historySource === 'REAL_TICKS' ? 'REAL TICKS' : historySource === 'RECONSTRUCTED_1M' ? '1M BARS' : 'LIVE ONLY'}
      tone={historySource === 'REAL_TICKS' ? 'live' : historySource === 'RECONSTRUCTED_1M' ? 'delayed' : 'none'}
      title={
        historySource === 'REAL_TICKS'
          ? 'Seeded with real historical trades'
          : historySource === 'RECONSTRUCTED_1M'
          ? 'Seeded from real 1-minute bars; intra-bar tick path reconstructed'
          : 'No free history reachable — accumulating live ticks only'
      }
    />
    <Chip
      label="GEX"
      value={gexSource === 'CBOE_DELAYED' ? 'CBOE DELAYED' : gexSource === 'LIVE' ? 'LIVE' : 'SIMULATED'}
      tone={gexSource === 'CBOE_DELAYED' ? 'delayed' : gexSource === 'LIVE' ? 'live' : 'sim'}
      title={gexSource === 'CBOE_DELAYED' ? 'Real gamma + open interest from CBOE (≈15 min delayed)' : 'Synthetic dealer-gamma model'}
    />
    <Chip label="FLOW" value="SIMULATED" tone="sim" title="Synthetic sweep/block tape" />
    <span className="text-[9px] text-slate-500 hidden 2xl:inline">
      · {symbol} · educational use only, not investment advice
    </span>
  </div>
);

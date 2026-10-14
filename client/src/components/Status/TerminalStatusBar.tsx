import React from 'react';
import { DataEvidence, EnhancedFeedStatus } from '../../types';

interface TerminalStatusBarProps {
  feedStatus: 'LIVE' | 'UNAVAILABLE' | EnhancedFeedStatus;
  isConnected: boolean;
  historySource: 'NONE' | 'REAL_TICKS' | 'REAL_BARS';
  isLoadingHistory: boolean;
  hasMoreHistory: boolean;
  sessionMode: 'LIVE' | 'REPLAY' | 'REPLAY_PAUSED' | 'REPLAY_ENDED';
  tickCount?: number;
  latencyMs?: number | null;
  lastUpdateTs?: number | null;
  dataSource?: string;
  delayNotice?: string;
  dataEvidence?: DataEvidence;
}

export const TerminalStatusBar: React.FC<TerminalStatusBarProps> = ({
  feedStatus,
  isConnected,
  historySource,
  isLoadingHistory,
  hasMoreHistory,
  sessionMode,
  tickCount = 0,
  latencyMs = null,
  lastUpdateTs = null,
  dataSource,
  delayNotice,
  dataEvidence,
}) => {
  // Resolve unified display status
  let displayStatus: EnhancedFeedStatus = 'UNAVAILABLE';
  if (!isConnected) {
    displayStatus = 'RECONNECTING';
  } else if (feedStatus === 'LIVE' || feedStatus === 'REALTIME') {
    displayStatus = 'REALTIME';
  } else if (feedStatus === 'DELAYED') {
    displayStatus = 'DELAYED';
  } else if (feedStatus === 'STALE') {
    displayStatus = 'STALE';
  } else if (feedStatus === 'MARKET_CLOSED') {
    displayStatus = 'MARKET_CLOSED';
  } else {
    displayStatus = 'UNAVAILABLE';
  }

  const statusConfig: Record<
    EnhancedFeedStatus,
    { label: string; color: string; dotClass: string; title: string }
  > = {
    LIVE: {
      label: 'REALTIME',
      color: 'text-[#19C37D]',
      dotClass: 'bg-[#19C37D] shadow-[0_0_8px_#19C37D]',
      title: 'Real-time CME Globex licensed vendor feed (live sub-second tick stream)',
    },
    REALTIME: {
      label: 'REALTIME',
      color: 'text-[#19C37D]',
      dotClass: 'bg-[#19C37D] shadow-[0_0_8px_#19C37D]',
      title: 'Real-time CME Globex licensed vendor feed (live sub-second tick stream)',
    },
    DELAYED: {
      label: delayNotice || 'DELAYED (15M)',
      color: 'text-[#38BDF8]',
      dotClass: 'bg-[#38BDF8] shadow-[0_0_8px_#38BDF8]',
      title: 'Verified delayed market data feed',
    },
    STALE: {
      label: 'STALE',
      color: 'text-[#F59E0B]',
      dotClass: 'bg-[#F59E0B] animate-pulse',
      title: 'Feed connected but no recent ticks received',
    },
    RECONNECTING: {
      label: 'RECONNECTING',
      color: 'text-[#FBBF24]',
      dotClass: 'bg-[#FBBF24] animate-ping',
      title: 'WebSocket attempting reconnection with exponential backoff',
    },
    MARKET_CLOSED: {
      label: 'MARKET CLOSED',
      color: 'text-[#94A3B8]',
      dotClass: 'bg-[#64748B]',
      title: 'Exchange session is outside active trading hours',
    },
    UNAVAILABLE: {
      label: 'UNAVAILABLE',
      color: 'text-[#F05252]',
      dotClass: 'bg-[#F05252]',
      title: 'Real-time vendor feed unavailable (configuration, entitlement or credentials)',
    },
  };

  const currentCfg = statusConfig[displayStatus];

  return (
    <footer className="terminal-status-bar select-none" role="contentinfo">
      {/* Left: Feed Status */}
      <div className="flex items-center gap-1.5 shrink-0" title={currentCfg.title}>
        <span className={`w-2 h-2 rounded-full ${currentCfg.dotClass}`} />
        <span className={`font-semibold tracking-wide ${currentCfg.color}`}>
          FEED: {currentCfg.label}
        </span>
        {dataSource && (
          <span className="text-[9px] px-1 py-0.2 bg-white/5 text-slate-400 rounded hidden md:inline">
            {dataSource}
          </span>
        )}
      </div>

      <div className="toolbar-divider hidden sm:block" />

      {/* Middle: data provenance + chart controls cheat sheet */}
      <div className="hidden lg:flex items-center gap-4 text-[#7F8B97] text-[10px] overflow-hidden">
        <span className="flex items-center gap-1" title="Where the candles and footprints on screen come from">
          <span className="text-[#4E5965]">History:</span>
          <span style={{ color: 'var(--text-primary)' }}>
            {historySource === 'REAL_TICKS'
              ? 'Real trades'
              : historySource === 'REAL_BARS'
                ? 'OHLCV bars · source unverified'
                : 'Streaming only'}
          </span>
        </span>

        <span data-testid="data-provenance" title={dataEvidence?.reason || 'Source and observation coverage not verified'} className="text-[#F59E0B]">
          {dataEvidence?.source || 'UNKNOWN'} · {dataEvidence?.quality || 'UNKNOWN'} · {dataEvidence?.coverage === 'COMPLETE' ? 'PARTIAL' : dataEvidence?.coverage || 'UNKNOWN'} · CVD observed baseline
        </span>
        {isLoadingHistory && <span className="text-[#22D3EE] animate-pulse">Loading history…</span>}
        {!hasMoreHistory && <span className="text-[#4E5965]">Archive start</span>}

        <span className="text-[#4E5965]">|</span>
        <span title="Toggle footprint / candle rendering">
          <strong className="font-normal" style={{ color: 'var(--text-primary)' }}>[F]</strong> mode
        </span>
        <span title="Toggle VWAP overlay">
          <strong className="font-normal" style={{ color: 'var(--text-primary)' }}>[V]</strong> VWAP
        </span>
        <span title="Toggle imbalance highlighting">
          <strong className="font-normal" style={{ color: 'var(--text-primary)' }}>[I]</strong> imbalance
        </span>
        <span title="Toggle delta numbers">
          <strong className="font-normal" style={{ color: 'var(--text-primary)' }}>[D]</strong> delta
        </span>
        <span title="Toggle the CVD sub-chart">
          <strong className="font-normal" style={{ color: 'var(--text-primary)' }}>[C]</strong> CVD
        </span>
        <span title="Open DOM / Profile / Tape / GEX / Flow directly">
          <strong className="font-normal" style={{ color: 'var(--text-primary)' }}>[1-5]</strong> panels
        </span>
        <span title="Toggle the analytics dock">
          <strong className="font-normal" style={{ color: 'var(--text-primary)' }}>[P]</strong> dock
        </span>
        <span title="Toggle replay / diagnostics / help">
          <strong className="font-normal" style={{ color: 'var(--text-primary)' }}>[R][S][?]</strong>
        </span>
        <span title="Open the command palette: instrument, timeframe, panel, overlays">
          <strong className="font-normal" style={{ color: 'var(--accent)' }}>[Ctrl+K]</strong> palette
        </span>
      </div>

      {/* Right: Technical Diagnostics */}
      <div className="ml-auto flex items-center gap-3 text-[#7F8B97] text-[10px] shrink-0 font-mono">
        <span className="hidden md:inline">
          <span className="text-[#4E5965]">Latency:</span>{' '}
          <span className="text-[#E7EDF3]">{typeof latencyMs === 'number' && latencyMs > 0 ? `${latencyMs}ms` : '--'}</span>
        </span>

        <span className="hidden sm:inline">
          <span className="text-[#4E5965]">Ticks:</span>{' '}
          <span className="text-[#E7EDF3]">{tickCount.toLocaleString()}</span>
        </span>

        <span className="flex items-center gap-1">
          <span className="text-[#4E5965]">Conn:</span>{' '}
          <span className={`font-semibold ${isConnected ? 'text-[#19C37D]' : 'text-[#F05252]'}`}>
            {isConnected ? (sessionMode === 'LIVE' ? 'LIVE' : sessionMode.replaceAll('_', ' ')) : 'OFFLINE'}
          </span>
        </span>
      </div>
    </footer>
  );
};

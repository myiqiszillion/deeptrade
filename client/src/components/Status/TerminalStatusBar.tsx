import React from 'react';

interface TerminalStatusBarProps {
  feedStatus: 'LIVE' | 'UNAVAILABLE';
  isConnected: boolean;
  historySource: 'NONE' | 'REAL_TICKS' | 'REAL_BARS';
  isLoadingHistory: boolean;
  hasMoreHistory: boolean;
  sessionMode: 'LIVE' | 'REPLAY' | 'REPLAY_PAUSED' | 'REPLAY_ENDED';
  tickCount?: number;
  latencyMs?: number | null;
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
}) => {
  const isLive = feedStatus === 'LIVE' && isConnected;

  return (
    <footer className="terminal-status-bar select-none" role="contentinfo">
      {/* Left: Feed Status */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className={`status-indicator-dot ${isLive ? 'live' : 'offline'}`} />
        <span className={`font-semibold tracking-wide ${isLive ? 'text-[#19C37D]' : 'text-[#F05252]'}`}>
          FEED: {isLive ? 'REALTIME' : 'UNAVAILABLE'}
        </span>
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
                ? 'Vendor bars'
                : 'Streaming only'}
          </span>
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

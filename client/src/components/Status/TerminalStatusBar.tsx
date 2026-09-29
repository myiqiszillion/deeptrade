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

      {/* Middle: Controls & Navigation Shortcuts */}
      <div className="hidden lg:flex items-center gap-4 text-[#7F8B97] text-[10px] overflow-hidden">
        <span className="flex items-center gap-1">
          <span className="text-[#4E5965]">History:</span>
          <span className="text-[#E7EDF3]">
            {historySource === 'REAL_TICKS'
              ? 'Real Trades'
              : historySource === 'REAL_BARS'
              ? 'Vendor Bars'
              : 'Streaming'}
          </span>
        </span>

        {isLoadingHistory && (
          <span className="text-[#22D3EE] animate-pulse">Loading history…</span>
        )}
        {!hasMoreHistory && (
          <span className="text-[#4E5965]">Archive Start</span>
        )}

        <span className="text-[#4E5965]">|</span>
        <span><strong className="text-[#E7EDF3] font-normal">[Drag]</strong> Pan</span>
        <span><strong className="text-[#E7EDF3] font-normal">[Scroll]</strong> Zoom X</span>
        <span><strong className="text-[#E7EDF3] font-normal">[Shift+Scroll]</strong> Price Scale</span>
        <span><strong className="text-[#E7EDF3] font-normal">[Double-Click]</strong> Reset View</span>
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

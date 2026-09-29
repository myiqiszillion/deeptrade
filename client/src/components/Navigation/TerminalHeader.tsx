import React from 'react';
import { Activity, Play, HelpCircle, PanelRight } from 'lucide-react';
import { FuturesInstrument } from '../../types';
import { InstrumentOption, SymbolDropdown } from './SymbolDropdown';
import { formatPrice } from '../../services/priceFormat';

interface TerminalHeaderProps {
  symbol: string;
  instrument?: FuturesInstrument;
  currentPrice: number;
  isConnected: boolean;
  feedStatus: 'LIVE' | 'UNAVAILABLE';
  sessionMode: 'LIVE' | 'REPLAY' | 'REPLAY_PAUSED' | 'REPLAY_ENDED';
  onSelectSymbol: (symbol: string) => void;
  showSystemStatus: boolean;
  onOpenSystemStatus: () => void;
  showReplay: boolean;
  onToggleReplay: () => void;
  showHelp: boolean;
  onToggleHelp: () => void;
  activePanel: string | null;
  onTogglePanel: () => void;
  highPrice?: number;
  lowPrice?: number;
  instrumentsList?: InstrumentOption[];
}

export const TerminalHeader: React.FC<TerminalHeaderProps> = ({
  symbol,
  instrument,
  currentPrice,
  isConnected,
  feedStatus,
  sessionMode,
  onSelectSymbol,
  showSystemStatus,
  onOpenSystemStatus,
  showReplay,
  onToggleReplay,
  showHelp,
  onToggleHelp,
  activePanel,
  onTogglePanel,
  highPrice,
  lowPrice,
  instrumentsList,
}) => {
  const tickSize = instrument?.tickSize || 0.25;
  const isLiveFeed = feedStatus === 'LIVE' && isConnected;

  return (
    <header className="terminal-header" role="banner">
      {/* 1. DeepChart Brand & Free Badge */}
      <div className="terminal-brand select-none">
        <span className="brand-icon">D</span>
        <span className="font-bold text-[#E7EDF3] tracking-tight">
          Deep<span className="text-[#22D3EE]">Chart</span>
        </span>
        <span className="free-badge">FREE</span>
      </div>

      <div className="toolbar-divider" />

      {/* 2. Instrument Selector */}
      <SymbolDropdown
        currentSymbol={symbol}
        currentInstrument={instrument}
        onSelectSymbol={onSelectSymbol}
        feedStatus={feedStatus}
        instruments={instrumentsList}
      />

      {/* 3. Primary Current Price (Strongest Visual Hierarchy) */}
      <div className="header-price-badge tabular-nums" title={`Current Price (${symbol})`}>
        <span className="header-price-value">
          {currentPrice > 0 ? formatPrice(currentPrice, tickSize) : '—'}
        </span>
      </div>

      {/* 4. Market Context (Session High / Low) */}
      {highPrice !== undefined && lowPrice !== undefined && highPrice > lowPrice && (
        <div className="hidden lg:flex items-center gap-1.5 px-2 py-1 rounded-[3px] bg-[#10151C] border border-[#1C2630] text-[10px] font-mono text-[#7F8B97] select-none">
          <span className="text-[#19C37D] font-semibold">H {formatPrice(highPrice, tickSize)}</span>
          <span className="text-[#4E5965]">/</span>
          <span className="text-[#F05252] font-semibold">L {formatPrice(lowPrice, tickSize)}</span>
        </div>
      )}

      {/* Replay indicator badge */}
      {sessionMode !== 'LIVE' && (
        <span className="px-2 py-0.5 rounded-[3px] bg-[#F5B942]/10 border border-[#F5B942]/30 text-[#F5B942] font-mono text-[10px] font-semibold">
          {sessionMode.replaceAll('_', ' ')}
        </span>
      )}

      {/* 5. Middle/Right Utilities: [Diagnostics] [LIVE FEED] [Replay] [Help] [Layout] */}
      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        {/* Diagnostics Button */}
        <button
          className={`terminal-btn ${showSystemStatus ? 'active' : ''}`}
          onClick={onOpenSystemStatus}
          title="System Diagnostics & Engine Hub"
        >
          <Activity size={13} className={showSystemStatus ? 'text-[#22D3EE]' : 'text-[#7F8B97]'} />
          <span className="hidden sm:inline">Diagnostics</span>
        </button>

        {/* Live Feed Status Pill */}
        <div
          className="flex items-center gap-1.5 px-2 py-1 rounded-[3px] bg-[#10151C] border border-[#1C2630] select-none"
          title={isLiveFeed ? 'Data Feed: Real-time validated tick stream' : 'Data Feed: Offline or reconnecting'}
        >
          <span
            className={`status-indicator-dot ${isLiveFeed ? 'live' : 'offline'}`}
          />
          <span className="font-mono text-[10px] font-semibold tracking-wide text-[#E7EDF3]">
            {isLiveFeed ? 'LIVE FEED' : 'OFFLINE'}
          </span>
        </div>

        {/* Replay Button */}
        <button
          className={`terminal-btn ${showReplay ? 'active text-[#F5B942] border-[#F5B942]/30' : ''}`}
          onClick={onToggleReplay}
          title="Toggle Tick Replay Controller"
          aria-pressed={showReplay}
        >
          <Play size={12} className={showReplay ? 'text-[#F5B942]' : 'text-[#7F8B97]'} />
          <span className="hidden md:inline">Replay</span>
        </button>

        {/* Help Button */}
        <button
          className={`terminal-btn terminal-btn-icon ${showHelp ? 'active text-[#22D3EE]' : ''}`}
          onClick={onToggleHelp}
          title="Order Flow Controls & Primer Guide"
          aria-label="Help"
          aria-expanded={showHelp}
        >
          <HelpCircle size={14} />
        </button>

        <div className="toolbar-divider" />

        {/* Layout / Analytics Workspace Dock Toggle */}
        <button
          className={`terminal-btn terminal-btn-icon ${activePanel ? 'active text-[#22D3EE]' : ''}`}
          onClick={onTogglePanel}
          title={activePanel ? `Close ${activePanel} panel` : 'Toggle Analytics Workspace Dock'}
          aria-label="Toggle analytics panel"
          aria-expanded={!!activePanel}
        >
          <PanelRight size={14} />
        </button>
      </div>
    </header>
  );
};

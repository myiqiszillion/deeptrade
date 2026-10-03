import React from 'react';
import { Activity, HelpCircle, LogOut, PanelRight, Play, Search, User } from 'lucide-react';
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
  /** Opens the Ctrl+K command palette — the fastest way to switch anything. */
  onOpenPalette?: () => void;
  username?: string | null;
  planName?: string | null;
  role?: string | null;
  onSignOut?: () => void;
  viewMode?: 'chart' | 'cockpit';
  onToggleViewMode?: () => void;
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
  onOpenPalette,
  username,
  planName,
  role,
  onSignOut,
  viewMode,
  onToggleViewMode,
}) => {
  const tickSize = instrument?.tickSize || 0.25;
  const isLiveFeed = feedStatus === 'LIVE' && isConnected;

  return (
    <header className="terminal-header" role="banner">
      {/* 1. Brand */}
      <div className="terminal-brand select-none">
        <span className="brand-icon">D</span>
        <span className="font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
          Deep<span style={{ color: 'var(--accent)' }}>Chart</span>
        </span>
      </div>

      <div className="toolbar-divider" />

      {/* 2. Instrument picker (click) — Ctrl+K is owned by the command palette */}
      <SymbolDropdown
        currentSymbol={symbol}
        currentInstrument={instrument}
        onSelectSymbol={onSelectSymbol}
        feedStatus={feedStatus}
        instruments={instrumentsList}
      />

      {onOpenPalette && (
        <button
          type="button"
          onClick={onOpenPalette}
          className="terminal-btn hidden md:inline-flex"
          title="Command palette: search instruments, timeframes, panels and actions (Ctrl+K)"
          aria-label="Open command palette"
        >
          <Search size={13} />
          <span className="hidden lg:inline">Search</span>
          <span className="dc-kbd">Ctrl K</span>
        </button>
      )}

      {/* 3. Last price — strongest visual anchor in the header */}
      <div className="header-price-badge tabular-nums" title={`Last traded price (${symbol})`}>
        <span className="header-price-value">{currentPrice > 0 ? formatPrice(currentPrice, tickSize) : '—'}</span>
      </div>

      {/* View Mode Switcher: Chart vs Cockpit HUD */}
      {onToggleViewMode && (
        <div className="flex items-center p-0.5 rounded bg-[#06090e] border border-[#00f2fe]/30 text-xs font-mono ml-1">
          <button
            type="button"
            onClick={viewMode === 'cockpit' ? onToggleViewMode : undefined}
            className={`px-2 py-0.5 rounded transition-all text-[11px] font-semibold flex items-center gap-1 ${
              viewMode !== 'cockpit'
                ? 'bg-[#1C2630] text-[#E7EDF3] shadow-sm'
                : 'text-[#7F8B97] hover:text-[#E7EDF3]'
            }`}
          >
            <span>CHART</span>
          </button>
          <button
            type="button"
            onClick={viewMode !== 'cockpit' ? onToggleViewMode : undefined}
            className={`px-2 py-0.5 rounded transition-all text-[11px] font-bold flex items-center gap-1.5 ${
              viewMode === 'cockpit'
                ? 'cyber-btn-active text-[#00f2fe] glow-text-cyan'
                : 'text-[#00f2fe]/80 hover:text-[#00f2fe]'
            }`}
            title="Switch to Futuristic Cyber Cockpit HUD (Hotkey: M)"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#00f2fe] shadow-[0_0_6px_#00f2fe] animate-pulse" />
            <span>COCKPIT HUD</span>
          </button>
        </div>
      )}

      {/* 4. Session context: range + replay state */}
      {highPrice !== undefined && lowPrice !== undefined && highPrice > lowPrice && (
        <div
          className="dc-chip hidden lg:inline-flex"
          title={`Session range across loaded history: ${formatPrice(lowPrice, tickSize)} – ${formatPrice(highPrice, tickSize)}`}
        >
          <span style={{ color: 'var(--ok)' }} className="font-semibold">
            H {formatPrice(highPrice, tickSize)}
          </span>
          <span style={{ color: 'var(--text-muted)' }}>/</span>
          <span style={{ color: 'var(--danger)' }} className="font-semibold">
            L {formatPrice(lowPrice, tickSize)}
          </span>
        </div>
      )}

      {sessionMode !== 'LIVE' && (
        <span className="dc-chip" data-tone="warn" title="Replay is running — the chart is not following live data">
          {sessionMode.replaceAll('_', ' ')}
        </span>
      )}

      {/* 5. Utilities */}
      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        <button
          className={`terminal-btn ${showSystemStatus ? 'active' : ''}`}
          onClick={onOpenSystemStatus}
          title="Diagnostics: feed state, entitlements, engine metrics"
          aria-pressed={showSystemStatus}
        >
          <Activity size={13} />
          <span className="hidden sm:inline">Diagnostics</span>
        </button>

        <div
          className="dc-chip"
          data-tone={isLiveFeed ? 'ok' : 'danger'}
          title={
            isLiveFeed
              ? 'Feed healthy: validated real-time ticks are flowing for this instrument'
              : 'Feed unavailable — open Diagnostics to see the reason (licence, credentials or connection)'
          }
        >
          <span className={`status-indicator-dot ${isLiveFeed ? 'live' : 'offline'}`} />
          <span className="font-semibold">{isLiveFeed ? 'LIVE' : 'OFFLINE'}</span>
        </div>

        <button
          className={`terminal-btn ${showReplay ? 'active' : ''}`}
          onClick={onToggleReplay}
          title="Replay recorded ticks without disturbing the live buffer"
          aria-pressed={showReplay}
        >
          <Play size={12} />
          <span className="hidden md:inline">Replay</span>
        </button>

        <button
          className={`terminal-btn terminal-btn-icon ${showHelp ? 'active' : ''}`}
          onClick={onToggleHelp}
          title="Chart controls cheat sheet"
          aria-label="Help"
          aria-expanded={showHelp}
        >
          <HelpCircle size={14} />
        </button>

        <div className="toolbar-divider" />

        <button
          className={`terminal-btn terminal-btn-icon ${activePanel ? 'active' : ''}`}
          onClick={onTogglePanel}
          title={activePanel ? `Close the ${activePanel} panel` : 'Open the analytics panel (DOM, Profile, Tape, GEX, Flow)'}
          aria-label="Toggle analytics panel"
          aria-expanded={!!activePanel}
        >
          <PanelRight size={14} />
        </button>

        {username && (
          <>
            <div className="toolbar-divider" />
            <div
              className="dc-chip"
              data-tone={role === 'admin' ? 'accent' : undefined}
              title={`Signed in as ${username}${role === 'admin' ? ' (admin)' : ''}${planName ? ` · ${planName} plan` : ''}`}
            >
              <User size={11} />
              <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                {username}
              </span>
              {planName && <span style={{ color: 'var(--text-muted)' }}>· {planName}</span>}
            </div>
            {onSignOut && (
              <button
                className="terminal-btn terminal-btn-icon"
                onClick={onSignOut}
                title="Sign out and revoke this session token"
                aria-label="Sign out"
              >
                <LogOut size={13} />
              </button>
            )}
          </>
        )}
      </div>
    </header>
  );
};


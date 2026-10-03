import React from 'react';
import {
  Activity,
  Camera,
  Crosshair,
  Expand,
  Gauge,
  List,
  Maximize2,
  PanelLeft,
  PanelRight,
  Play,
  Radio,
  RotateCcw,
  Search,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

interface ToolRailProps {
  autoFollow: boolean;
  onToggleAutoFollow: () => void;
  onFitView: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onOpenPalette: () => void;
  watchlistOpen: boolean;
  onToggleWatchlist: () => void;
  dockSide: 'left' | 'right';
  onToggleDockSide: () => void;
  replayOpen: boolean;
  onToggleReplay: () => void;
  onOpenDiagnostics: () => void;
  onScreenshot: () => void;
  onToggleFullscreen: () => void;
  isFullscreen: boolean;
  viewMode?: 'chart' | 'cockpit';
  onToggleCockpit?: () => void;
}

/**
 * Left tool rail, TradingView-style.
 *
 * Only actions the terminal can actually perform are shown (pan/zoom model, layout, replay, capture) — a
 * rail full of dead drawing tools would look closer to TradingView but lie about what the product does.
 */
export const ToolRail: React.FC<ToolRailProps> = ({
  autoFollow,
  onToggleAutoFollow,
  onFitView,
  onZoomIn,
  onZoomOut,
  onOpenPalette,
  watchlistOpen,
  onToggleWatchlist,
  dockSide,
  onToggleDockSide,
  replayOpen,
  onToggleReplay,
  onOpenDiagnostics,
  onScreenshot,
  onToggleFullscreen,
  isFullscreen,
  viewMode,
  onToggleCockpit,
}) => (
  <nav className="tv-toolrail" aria-label="Chart tools">
    <button className="tv-rail-btn" onClick={onOpenPalette} title="Symbol search (Ctrl+K)" aria-label="Symbol search">
      <Search size={15} />
    </button>

    {onToggleCockpit && (
      <button
        className={`tv-rail-btn ${viewMode === 'cockpit' ? 'active text-[#00f2fe]' : 'text-[#00f2fe]/70 hover:text-[#00f2fe]'}`}
        onClick={onToggleCockpit}
        title="Toggle Futuristic Cyber Cockpit HUD (Hotkey: M)"
        aria-label="Toggle Cockpit HUD"
        aria-pressed={viewMode === 'cockpit'}
      >
        <Radio size={15} className={viewMode === 'cockpit' ? 'animate-pulse text-[#00f2fe]' : ''} />
      </button>
    )}

    <div className="tv-rail-sep" />

    <button
      className="tv-rail-btn"
      aria-pressed={autoFollow}
      onClick={autoFollow ? onToggleAutoFollow : undefined}
      disabled={autoFollow}
      title={autoFollow ? 'Auto-fit is following the market' : 'Follow the market again'}
      aria-label="Auto fit"
    >
      <Crosshair size={15} />
    </button>
    <button
      className="tv-rail-btn"
      aria-pressed={!autoFollow}
      onClick={autoFollow ? onToggleAutoFollow : undefined}
      disabled={!autoFollow}
      title="Manual pan / zoom (drag and wheel)"
      aria-label="Manual view"
    >
      <Gauge size={15} />
    </button>
    <button className="tv-rail-btn" onClick={onZoomIn} title="Zoom in (bar width)" aria-label="Zoom in">
      <ZoomIn size={15} />
    </button>
    <button className="tv-rail-btn" onClick={onZoomOut} title="Zoom out (bar width)" aria-label="Zoom out">
      <ZoomOut size={15} />
    </button>
    <button className="tv-rail-btn" onClick={onFitView} title="Reset view (double-click the chart)" aria-label="Reset view">
      <RotateCcw size={15} />
    </button>

    <div className="tv-rail-sep" />

    <button
      className="tv-rail-btn"
      aria-pressed={watchlistOpen}
      onClick={onToggleWatchlist}
      title="Watchlist"
      aria-label="Toggle watchlist"
    >
      <List size={15} />
    </button>
    <button
      className="tv-rail-btn"
      onClick={onToggleDockSide}
      title={dockSide === 'right' ? 'Dock analytics to the left' : 'Dock analytics to the right'}
      aria-label="Move analytics dock"
    >
      {dockSide === 'right' ? <PanelLeft size={15} /> : <PanelRight size={15} />}
    </button>
    <button
      className="tv-rail-btn"
      aria-pressed={replayOpen}
      onClick={onToggleReplay}
      title="Replay recorded ticks"
      aria-label="Toggle replay"
    >
      <Play size={15} />
    </button>

    <div className="tv-rail-sep" />

    <button className="tv-rail-btn" onClick={onOpenDiagnostics} title="Diagnostics: feed, entitlements, engine" aria-label="Diagnostics">
      <Activity size={15} />
    </button>
    <button className="tv-rail-btn" onClick={onScreenshot} title="Save chart image (PNG)" aria-label="Save chart image">
      <Camera size={15} />
    </button>
    <button
      className="tv-rail-btn"
      aria-pressed={isFullscreen}
      onClick={onToggleFullscreen}
      title="Fullscreen"
      aria-label="Toggle fullscreen"
    >
      {isFullscreen ? <Expand size={15} /> : <Maximize2 size={15} />}
    </button>
  </nav>
);

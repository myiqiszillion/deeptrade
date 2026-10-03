import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, X } from 'lucide-react';
import { SplitHandle } from '../Layout/SplitHandle';
import { DOMScalper } from '../DOM/DOMScalper';
import { ProfileOverlay } from '../Profile/ProfileOverlay';
import { SpeedOfTapeWidget } from '../Tape/SpeedOfTapeWidget';
import { GEXPanel } from '../Options/GEXPanel';
import { OptionsFlowWidget } from '../Options/OptionsFlowWidget';
import { DarkpoolWidget } from '../Darkpool/DarkpoolWidget';
import { Institutional13FWidget } from '../Institutional/Institutional13FWidget';
import { SignalPanel } from '../Intelligence/SignalPanel';
import { SimilarDaysPanel } from '../Intelligence/SimilarDaysPanel';
import { EventTimeline } from '../Intelligence/EventTimeline';
import { CrossAssetPanel } from '../Intelligence/CrossAssetPanel';
import { VolSurfacePanel } from '../Options/VolSurface';
import { SymbolSearch } from '../SymbolSearch/SymbolSearch';
import { DataExplorer } from '../DataExplorer/DataExplorer';
import { BacktestPanel } from '../Research/BacktestPanel';
import { ResearchLabPanel } from '../Research/ResearchLabPanel';
import { CopilotPanel } from '../AI/CopilotPanel';
import {
  DeepTrade,
  FuturesInstrument,
  GEXProfile,
  OptionsFlowTrade,
  OrderbookSnapshot,
  SpeedOfTapeData,
  TPOProfileData,
  Tick,
  VolumeProfileData,
} from '../../types';

interface WorkspaceDockProps {
  activePanel: 'DOM' | 'Profile' | 'Tape' | 'GEX' | 'Flow' | 'Darkpool' | '13F' | 'Signal' | 'History' | 'Events' | 'Cross' | 'Vol' | 'Backtest' | 'Lab' | 'Copilot' | 'SymbolSearch' | 'DataExplorer' | null;
  onClose: () => void;
  /** Switch panels without leaving the dock (the toolbar is far away when you are reading order flow). */
  onSelectPanel: (panel: 'DOM' | 'Profile' | 'Tape' | 'GEX' | 'Flow' | 'Darkpool' | '13F' | 'Signal' | 'History' | 'Events' | 'Cross' | 'Vol' | 'Backtest' | 'Lab' | 'Copilot' | 'SymbolSearch' | 'DataExplorer') => void;
  /** Which side of the chart the dock is anchored to; the divider follows it. */
  side: 'left' | 'right';
  onToggleSide: () => void;
  symbol: string;
  currentPrice: number;
  instrument?: FuturesInstrument;
  orderbook: OrderbookSnapshot;
  volumeProfile: VolumeProfileData;
  tpoProfile: TPOProfileData;
  tape: SpeedOfTapeData;
  recentTicks: Tick[];
  deepTrades: DeepTrade[];
  deepTradeThresholdUsd?: number;
  gexProfile?: GEXProfile;
  optionsFlow: OptionsFlowTrade[];
}

const DOCK_WIDTH_STORAGE_KEY = 'deepchart_dock_width_v1';

const PANELS: Array<{ id: 'DOM' | 'Profile' | 'Tape' | 'GEX' | 'Flow' | 'Darkpool' | '13F' | 'Signal' | 'History' | 'Events' | 'Cross' | 'Vol' | 'Backtest' | 'Lab' | 'Copilot' | 'SymbolSearch' | 'DataExplorer'; label: string; hint: string }> = [
  { id: 'DOM', label: 'DOM', hint: 'Depth of market ladder with live resting size' },
  { id: 'Profile', label: 'Profile', hint: 'Volume Profile + TPO (Market Profile) for the session' },
  { id: 'Tape', label: 'Tape', hint: 'Speed of tape and block (whale) prints' },
  { id: 'GEX', label: 'GEX', hint: 'Gamma exposure from a real option chain' },
  { id: 'Flow', label: 'Flow', hint: 'Options flow prints' },
  { id: 'Darkpool', label: 'Darkpool', hint: 'Darkpool block trades' },
  { id: '13F', label: '13F', hint: 'Institutional holdings' },
  { id: 'Signal', label: 'Signal', hint: 'Feature scores (no BUY/SELL)' },
  { id: 'History', label: 'Similar', hint: 'Historical similar days' },
  { id: 'Events', label: 'Events', hint: 'Event timeline' },
  { id: 'Cross', label: 'Cross', hint: 'Cross-asset evidence' },
  { id: 'Vol', label: 'Vol', hint: 'Volatility surface' },
  { id: 'Backtest', label: 'Backtest', hint: 'Backtest occurrences & moves' },
  { id: 'Lab', label: 'Lab', hint: 'Research Lab query' },
  { id: 'Copilot', label: 'Copilot', hint: 'QuantDecay Copilot' },
  { id: 'SymbolSearch', label: 'Symbols', hint: 'Symbol search' },
  { id: 'DataExplorer', label: 'Explorer', hint: 'Data Explorer' },
];

export const WorkspaceDock: React.FC<WorkspaceDockProps> = ({
  activePanel,
  onClose,
  onSelectPanel,
  side,
  onToggleSide,
  symbol,
  currentPrice,
  instrument,
  orderbook,
  volumeProfile,
  tpoProfile,
  tape,
  recentTicks,
  deepTrades,
  deepTradeThresholdUsd,
  gexProfile,
  optionsFlow,
}) => {
  const [width, setWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(DOCK_WIDTH_STORAGE_KEY);
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (parsed >= 280 && parsed <= 650) return parsed;
      }
    } catch {
      /* storage unavailable: fall back to the default width */
    }
    return 350;
  });

  const clampWidth = (value: number) => Math.max(280, Math.min(650, value));

  // SplitHandle reports the *cumulative* drag delta, so the width is computed from the width captured at
  // drag start — adding to the live state would compound on every animation frame.
  const dragStartWidthRef = useRef(width);

  // Persist on every change: the layout survives a refresh, and there is no "lost my width" surprise after
  // a drag that ends outside the window (pointer capture guarantees we still get the final pointerup).
  useEffect(() => {
    try {
      localStorage.setItem(DOCK_WIDTH_STORAGE_KEY, String(width));
    } catch {
      /* ignore */
    }
  }, [width]);

  if (!activePanel) return null;

  return (
    <aside
      className="analytics-dock"
      data-side={side}
      style={{ width: `${width}px` }}
      aria-label={`${activePanel} analytics dock`}
    >
      {/* Divider: drag (or ←/→, Home resets) to resize; double-click restores the default width */}
      <SplitHandle
        orientation="vertical"
        className={side === 'right' ? 'dock-split-handle dock-split-inner-left' : 'dock-split-handle dock-split-inner-right'}
        label="Resize analytics dock"
        hint="Drag to resize the dock"
        invert={side === 'right'}
        onDragStart={() => {
          dragStartWidthRef.current = width;
        }}
        onDrag={(delta) => setWidth(clampWidth(dragStartWidthRef.current + delta))}
        onStep={(delta) => setWidth((prev) => clampWidth(prev + delta))}
        onReset={() => setWidth(350)}
      />

      {/* Dock Header: panel switcher + context + close */}
      <div className="dock-header select-none">
        <div className="flex items-center gap-1 min-w-0">
          {PANELS.map((panel) => (
            <button
              key={panel.id}
              type="button"
              aria-pressed={activePanel === panel.id}
              onClick={() => onSelectPanel(panel.id)}
              title={panel.hint}
              className={`h-6 px-2 rounded font-mono text-[10px] font-semibold uppercase tracking-wide transition-colors ${
                activePanel === panel.id
                  ? 'bg-[#1C2630] text-[#E7EDF3]'
                  : 'text-[#7F8B97] hover:text-[#E7EDF3] hover:bg-white/5'
              }`}
            >
              {panel.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-mono text-[10px] text-[#7F8B97]">{symbol}</span>
          <button
            type="button"
            className="terminal-btn terminal-btn-icon h-6 w-6"
            aria-label={side === 'right' ? 'Move dock to the left' : 'Move dock to the right'}
            title={side === 'right' ? 'Chuyển dock sang trái' : 'Chuyển dock sang phải'}
            onClick={onToggleSide}
          >
            <ArrowLeftRight size={12} />
          </button>
          <button
            className="terminal-btn terminal-btn-icon h-6 w-6"
            aria-label="Close panel"
            title="Close panel"
            onClick={onClose}
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Dock Panel Body */}
      <div className="dock-content">
        {activePanel === 'DOM' && (
          <DOMScalper
            orderbook={orderbook}
            currentPrice={currentPrice}
            symbol={symbol}
            isFutures={true}
            tickSize={instrument?.tickSize}
          />
        )}

        {activePanel === 'Profile' && (
          <ProfileOverlay
            volumeProfile={volumeProfile}
            tpoProfile={tpoProfile}
            currentPrice={currentPrice}
            tickSize={instrument?.tickSize}
          />
        )}

        {activePanel === 'Tape' && (
          <SpeedOfTapeWidget
            tape={tape}
            recentTicks={recentTicks}
            deepTrades={deepTrades}
            symbol={symbol}
            deepTradeThresholdUsd={deepTradeThresholdUsd}
            tickSize={instrument?.tickSize}
          />
        )}

        {activePanel === 'GEX' && (
          <GEXPanel symbol={symbol} currentPrice={currentPrice} />
        )}

        {activePanel === 'Flow' && (
          <OptionsFlowWidget symbol={symbol} />
        )}

        {activePanel === 'Darkpool' && (
          <DarkpoolWidget symbol={symbol} />
        )}

        {activePanel === '13F' && (
          <Institutional13FWidget />
        )}
        {activePanel === 'Signal' && <SignalPanel symbol={symbol} />}
        {activePanel === 'History' && <SimilarDaysPanel symbol={symbol} />}
        {activePanel === 'Events' && <EventTimeline symbol={symbol} />}
        {activePanel === 'Cross' && <CrossAssetPanel symbol={symbol} />}
        {activePanel === 'Vol' && <VolSurfacePanel symbol={symbol} />}
        {activePanel === 'Backtest' && <BacktestPanel symbol={symbol} />}
        {activePanel === 'Lab' && <ResearchLabPanel symbol={symbol} />}
        {activePanel === 'Copilot' && <CopilotPanel symbol={symbol} />}
        {activePanel === 'SymbolSearch' && <SymbolSearch />}
        {activePanel === 'DataExplorer' && <DataExplorer />}
      </div>
    </aside>
  );
};

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import { DOMScalper } from '../DOM/DOMScalper';
import { ProfileOverlay } from '../Profile/ProfileOverlay';
import { SpeedOfTapeWidget } from '../Tape/SpeedOfTapeWidget';
import { GEXPanel } from '../Options/GEXPanel';
import { OptionsFlowWidget } from '../Options/OptionsFlowWidget';
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
  activePanel: 'DOM' | 'Profile' | 'Tape' | 'GEX' | 'Flow' | null;
  onClose: () => void;
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

export const WorkspaceDock: React.FC<WorkspaceDockProps> = ({
  activePanel,
  onClose,
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
    } catch {}
    return 350;
  });

  const isResizingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(width);

  const handleMouseDown = (e: React.MouseEvent) => {
    isResizingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizingRef.current) return;
    const delta = startXRef.current - e.clientX;
    const newWidth = Math.max(280, Math.min(650, startWidthRef.current + delta));
    setWidth(newWidth);
  }, []);

  const handleMouseUp = useCallback(() => {
    if (isResizingRef.current) {
      isResizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try {
        localStorage.setItem(DOCK_WIDTH_STORAGE_KEY, width.toString());
      } catch {}
    }
  }, [width]);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  if (!activePanel) return null;

  return (
    <aside
      className="analytics-dock"
      style={{ width: `${width}px` }}
      aria-label={`${activePanel} analytics dock`}
    >
      {/* Drag Resize Handle */}
      <div
        className="dock-resize-handle"
        onMouseDown={handleMouseDown}
        title="Drag to resize panel"
      />

      {/* Dock Header */}
      <div className="dock-header select-none">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-xs text-[#E7EDF3] tracking-wide uppercase">
            {activePanel}
          </span>
          <span className="text-[#4E5965] font-mono text-[10px]">/</span>
          <span className="text-[#7F8B97] font-mono text-xs">{symbol}</span>
        </div>
        <button
          className="terminal-btn terminal-btn-icon h-6 w-6 text-[#7F8B97] hover:text-[#E7EDF3]"
          aria-label="Close panel"
          title="Close panel"
          onClick={onClose}
        >
          <X size={13} />
        </button>
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
          <GEXPanel profile={gexProfile} currentPrice={currentPrice} />
        )}

        {activePanel === 'Flow' && (
          <OptionsFlowWidget flowTrades={optionsFlow} />
        )}
      </div>
    </aside>
  );
};

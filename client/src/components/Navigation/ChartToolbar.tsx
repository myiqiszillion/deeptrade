import React, { useState, useRef, useEffect } from 'react';
import { RotateCcw, ZoomIn, ZoomOut, Check, Sliders, ChevronDown } from 'lucide-react';

export interface SignalFilters {
  buyAbs: boolean;
  sellAbs: boolean;
  gamma: boolean;
  whale: boolean;
}

interface ChartToolbarProps {
  chartMode: 'footprint' | 'candles';
  onChartModeChange: (mode: 'footprint' | 'candles') => void;
  timeframe: string;
  onTimeframeChange: (tf: string) => void;
  clusterMultiplier: 'auto' | 1 | 2 | 4 | 5 | 10 | 25 | 50;
  onClusterChange: (c: 'auto' | 1 | 2 | 5 | 10 | 25) => void;
  showVWAP: boolean;
  onToggleVWAP: () => void;
  showImbalances: boolean;
  onToggleImbalances: () => void;
  showDeltaNumbers: boolean;
  onToggleDeltaNumbers: () => void;
  showCVD: boolean;
  onToggleCVD: () => void;
  signalFilters: SignalFilters;
  onToggleSignalFilter: (key: keyof SignalFilters) => void;
  autoFollow: boolean;
  onToggleAutoFollow: () => void;
  onFitView: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  activePanel: 'DOM' | 'Profile' | 'Tape' | 'GEX' | 'Flow' | null;
  onSelectPanel: (panel: 'DOM' | 'Profile' | 'Tape' | 'GEX' | 'Flow') => void;
}

export const ChartToolbar: React.FC<ChartToolbarProps> = ({
  chartMode,
  onChartModeChange,
  timeframe,
  onTimeframeChange,
  clusterMultiplier,
  onClusterChange,
  showVWAP,
  onToggleVWAP,
  showImbalances,
  onToggleImbalances,
  showDeltaNumbers,
  onToggleDeltaNumbers,
  showCVD,
  onToggleCVD,
  signalFilters,
  onToggleSignalFilter,
  autoFollow,
  onToggleAutoFollow,
  onFitView,
  onZoomIn,
  onZoomOut,
  activePanel,
  onSelectPanel,
}) => {
  const [indicatorsMenuOpen, setIndicatorsMenuOpen] = useState(false);
  const indicatorsMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (indicatorsMenuRef.current && !indicatorsMenuRef.current.contains(e.target as Node)) {
        setIndicatorsMenuOpen(false);
      }
    };
    if (indicatorsMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [indicatorsMenuOpen]);

  return (
    <nav className="chart-toolbar select-none" aria-label="Chart controls">
      {/* GROUP 1: Mode Switcher (Footprint | Candles) */}
      <div className="toolbar-group">
        {(['footprint', 'candles'] as const).map((mode) => (
          <button
            key={mode}
            aria-pressed={chartMode === mode}
            onClick={() => onChartModeChange(mode)}
            className={`toolbar-button capitalize ${chartMode === mode ? 'active' : ''}`}
            title={`Switch to ${mode} mode`}
          >
            {mode}
          </button>
        ))}
      </div>

      <div className="toolbar-divider" />

      {/* GROUP 2: Timeframes (1s | 5s | 15s | 1m | 5m | 15m) */}
      <div className="toolbar-group">
        {(['1s', '5s', '15s', '1m', '5m', '15m'] as const).map((tf) => (
          <button
            key={tf}
            aria-pressed={timeframe === tf}
            onClick={() => onTimeframeChange(tf)}
            className={`toolbar-button ${timeframe === tf ? 'active active-cyan' : ''}`}
            title={`Set timeframe to ${tf}`}
          >
            {tf}
          </button>
        ))}
      </div>

      {/* GROUP 3: Cluster Multiplier (Auto | 1T | 2T | 5T | 10T | 25T) */}
      {chartMode === 'footprint' && (
        <>
          <div className="toolbar-divider hidden md:block" />
          <div className="toolbar-group hidden md:inline-flex">
            <span className="toolbar-label">Cluster</span>
            {(['auto', 1, 2, 5, 10, 25] as const).map((mul) => (
              <button
                key={String(mul)}
                onClick={() => onClusterChange(mul)}
                className={`toolbar-button ${
                  clusterMultiplier === mul ? 'active active-cyan' : ''
                }`}
                title={mul === 'auto' ? 'Dynamic tick clustering' : `Cluster by ${mul} tick(s)`}
              >
                {mul === 'auto' ? 'Auto' : `${mul}T`}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="toolbar-divider" />

      {/* GROUP 4: Indicators (VWAP | Imbalance | Delta | CVD) */}
      {/* Desktop view (>= 1536px): Full inline group */}
      <div className="toolbar-group indicators-desktop-group">
        <button
          className={`toolbar-button ${showVWAP ? 'active-amber' : ''}`}
          aria-pressed={showVWAP}
          onClick={onToggleVWAP}
          title="Anchored VWAP and ±1σ Bands"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[#F5B942]" />
          <span>VWAP</span>
        </button>

        <button
          className={`toolbar-button ${showImbalances ? 'active-emerald' : ''}`}
          aria-pressed={showImbalances}
          onClick={onToggleImbalances}
          title="Diagonal Order Flow Imbalances"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[#19C37D]" />
          <span>Imbalance</span>
        </button>

        <button
          className={`toolbar-button ${showDeltaNumbers ? 'active-cyan' : ''}`}
          aria-pressed={showDeltaNumbers}
          onClick={onToggleDeltaNumbers}
          title="Bar Delta & Volume Summary"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[#22D3EE]" />
          <span>Delta</span>
        </button>

        <button
          className={`toolbar-button ${showCVD ? 'active-purple' : ''}`}
          aria-pressed={showCVD}
          onClick={onToggleCVD}
          title="Cumulative Volume Delta Sub-panel"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[#A78BFA]" />
          <span>CVD</span>
        </button>
      </div>

      {/* Responsive Collapsible Dropdown for Indicators (< 1536px) */}
      <div className="relative indicators-mobile-group" ref={indicatorsMenuRef}>
        <div className="toolbar-group">
          <button
            onClick={() => setIndicatorsMenuOpen(!indicatorsMenuOpen)}
            className={`toolbar-button ${
              showVWAP || showImbalances || showDeltaNumbers || showCVD ? 'active-cyan' : ''
            }`}
            title="Toggle Indicators"
          >
            <Sliders size={11} />
            <span>Indicators</span>
            <ChevronDown size={11} className={indicatorsMenuOpen ? 'rotate-180' : ''} />
          </button>
        </div>

        {indicatorsMenuOpen && (
          <div className="absolute top-full left-0 mt-1 py-1 px-1 rounded-[3px] bg-[#0D1218] border border-[#25303A] shadow-[0_8px_24px_rgba(0,0,0,0.85)] z-50 flex flex-col gap-1 min-w-[130px]">
            <button
              onClick={() => { onToggleVWAP(); }}
              className={`toolbar-button justify-start w-full ${showVWAP ? 'active-amber' : ''}`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#F5B942]" />
              <span>VWAP</span>
              {showVWAP && <Check size={11} className="ml-auto text-[#F5B942]" />}
            </button>
            <button
              onClick={() => { onToggleImbalances(); }}
              className={`toolbar-button justify-start w-full ${showImbalances ? 'active-emerald' : ''}`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#19C37D]" />
              <span>Imbalance</span>
              {showImbalances && <Check size={11} className="ml-auto text-[#19C37D]" />}
            </button>
            <button
              onClick={() => { onToggleDeltaNumbers(); }}
              className={`toolbar-button justify-start w-full ${showDeltaNumbers ? 'active-cyan' : ''}`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#22D3EE]" />
              <span>Delta</span>
              {showDeltaNumbers && <Check size={11} className="ml-auto text-[#22D3EE]" />}
            </button>
            <button
              onClick={() => { onToggleCVD(); }}
              className={`toolbar-button justify-start w-full ${showCVD ? 'active-purple' : ''}`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#A78BFA]" />
              <span>CVD</span>
              {showCVD && <Check size={11} className="ml-auto text-[#A78BFA]" />}
            </button>
          </div>
        )}
      </div>

      <div className="toolbar-divider" />

      {/* SIGNAL FILTER BAR: [BUY ABS] [SELL ABS] [GAMMA] [WHALE] */}
      <div className="signal-filter-group" title="Microstructure Signal Filters">
        <span className="toolbar-label hidden xl:inline">Signals</span>
        <button
          onClick={() => onToggleSignalFilter('buyAbs')}
          className={`signal-filter-pill ${
            signalFilters.buyAbs
              ? 'active text-[#A78BFA] border-[#A78BFA]/30'
              : 'inactive'
          }`}
          title="Filter: Passive Buyer Absorption"
        >
          BUY ABS
        </button>
        <button
          onClick={() => onToggleSignalFilter('sellAbs')}
          className={`signal-filter-pill ${
            signalFilters.sellAbs
              ? 'active text-[#F472B6] border-[#F472B6]/30'
              : 'inactive'
          }`}
          title="Filter: Passive Seller Absorption"
        >
          SELL ABS
        </button>
        <button
          onClick={() => onToggleSignalFilter('gamma')}
          className={`signal-filter-pill ${
            signalFilters.gamma
              ? 'active text-[#19C37D] border-[#19C37D]/30'
              : 'inactive'
          }`}
          title="Filter: Institutional Gamma Levels (Call/Put Walls)"
        >
          GAMMA
        </button>
        <button
          onClick={() => onToggleSignalFilter('whale')}
          className={`signal-filter-pill ${
            signalFilters.whale
              ? 'active text-[#38BDF8] border-[#38BDF8]/30'
              : 'inactive'
          }`}
          title="Filter: Institutional Block Trades (Whales)"
        >
          ◆ WHALE
        </button>
      </div>

      <div className="toolbar-divider" />

      {/* GROUP 5: Fit View / Manual Controls */}
      <div className="toolbar-group">
        <button
          onClick={autoFollow ? undefined : onToggleAutoFollow}
          className={`toolbar-button ${autoFollow ? 'active active-emerald' : ''}`}
          title={autoFollow ? 'Auto Fit active: tracking current price & visible range' : 'Enable Auto Fit'}
        >
          {autoFollow && <Check size={11} className="text-[#19C37D]" />}
          <span>Auto Fit</span>
        </button>
        <button
          onClick={autoFollow ? onToggleAutoFollow : undefined}
          className={`toolbar-button ${!autoFollow ? 'active' : ''}`}
          title={!autoFollow ? 'Manual zoom/pan mode active' : 'Switch to Manual Mode'}
        >
          <span>Manual</span>
        </button>

        {/* In Manual mode: show zoom and pan reset */}
        {!autoFollow && onZoomIn && onZoomOut && (
          <>
            <button
              onClick={onZoomIn}
              className="toolbar-button px-1"
              title="Zoom In (Bar Width)"
            >
              <ZoomIn size={12} />
            </button>
            <button
              onClick={onZoomOut}
              className="toolbar-button px-1"
              title="Zoom Out (Bar Width)"
            >
              <ZoomOut size={12} />
            </button>
          </>
        )}
        <button
          onClick={onFitView}
          className="toolbar-button px-1.5"
          title="Reset View & Fit Visible Price Action (Double-click chart)"
        >
          <RotateCcw size={11} />
        </button>
      </div>

      {/* GROUP 6: Workspace Switcher Tabs (DOM | PROFILE | TAPE | GEX | FLOW) */}
      <div className="toolbar-group ml-auto">
        {(['DOM', 'Profile', 'Tape', 'GEX', 'Flow'] as const).map((panel) => (
          <button
            key={panel}
            aria-pressed={activePanel === panel}
            onClick={() => onSelectPanel(panel)}
            className={`toolbar-button uppercase font-semibold text-[10px] ${
              activePanel === panel ? 'active active-cyan' : ''
            }`}
            title={`Toggle ${panel} workspace panel`}
          >
            {panel}
          </button>
        ))}
      </div>
    </nav>
  );
};


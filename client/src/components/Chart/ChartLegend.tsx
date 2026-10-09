import React from 'react';
import { OverlayKey } from '../CommandPalette';

interface ChartLegendProps {
  symbol: string;
  timeframe: string;
  chartMode: 'footprint' | 'candles';
  exchange?: string;
  /** Last rendered bar; the legend never invents values when there is no bar yet. */
  lastBar?: { open: number; high: number; low: number; close: number; volume?: number };
  previousClose?: number;
  feedStatus: 'LIVE' | 'UNAVAILABLE';
  overlays: Record<OverlayKey, boolean>;
  onToggleOverlay: (key: OverlayKey) => void;
  decimals?: number;
}

const fmt = (value: number | undefined, decimals: number): string =>
  typeof value === 'number' && Number.isFinite(value) ? value.toFixed(decimals) : '—';

/**
 * Floating chart legend (TradingView's top-left readout): symbol, timeframe, OHLC of the last bar and the
 * indicator chips. Chips toggle the overlays that really exist, so the legend doubles as a control panel.
 */
export const ChartLegend: React.FC<ChartLegendProps> = ({
  symbol,
  timeframe,
  chartMode,
  exchange,
  lastBar,
  previousClose,
  feedStatus,
  overlays,
  onToggleOverlay,
  decimals = 2,
}) => {
  const change = lastBar && typeof previousClose === 'number' && previousClose !== 0
    ? ((lastBar.close - previousClose) / previousClose) * 100
    : undefined;
  const changeColor = change === undefined ? 'var(--text-secondary)' : change >= 0 ? 'var(--buy)' : 'var(--sell)';

  const chips: Array<{ key: OverlayKey; label: string }> = [
    { key: 'vwap', label: 'VWAP' },
    { key: 'cvd', label: 'CVD' },
    { key: 'imbalances', label: 'Imbalance' },
    { key: 'delta', label: 'Delta' },
  ];

  return (
    <div className="tv-legend" role="status" aria-label="Chart legend">
      <span className="tv-legend-symbol">{symbol}</span>
      <span className="text-[#787B86]">·</span>
      <span className="text-[#787B86]">{timeframe}</span>
      <span className="text-[#787B86]">·</span>
      <span className="text-[#787B86]">{chartMode === 'footprint' ? 'Footprint' : 'Candles'}</span>
      {exchange && (
        <>
          <span className="text-[#787B86]">·</span>
          <span className="text-[#787B86]">{exchange}</span>
        </>
      )}

      <span className="tv-legend-ohlc">
        <span>
          O <span className="text-[#D1D4DC]">{fmt(lastBar?.open, decimals)}</span>
        </span>
        <span>
          H <span className="text-[#089981]">{fmt(lastBar?.high, decimals)}</span>
        </span>
        <span>
          L <span className="text-[#F23645]">{fmt(lastBar?.low, decimals)}</span>
        </span>
        <span>
          C <span className="text-[#D1D4DC]">{fmt(lastBar?.close, decimals)}</span>
        </span>
        {lastBar && (
          <span>
            V <span className="text-[#D1D4DC]">{lastBar.volume !== undefined ? Math.round(lastBar.volume).toLocaleString() : '—'}</span>
          </span>
        )}
        {change !== undefined && (
          <span style={{ color: changeColor }}>
            {change >= 0 ? '+' : ''}
            {change.toFixed(2)}%
          </span>
        )}
      </span>

      <span className="dc-chip" data-tone={feedStatus === 'LIVE' ? 'ok' : 'danger'}>
        <span className={`status-indicator-dot ${feedStatus === 'LIVE' ? 'live' : 'offline'}`} />
        {feedStatus === 'LIVE' ? 'live' : 'no feed'}
      </span>

      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          className="tv-legend-chip"
          aria-pressed={overlays[chip.key]}
          onClick={() => onToggleOverlay(chip.key)}
          title={`Bật/tắt ${chip.label}`}
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
};

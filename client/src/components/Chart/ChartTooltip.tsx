import React from 'react';
import { formatPrice, formatVolume } from '../../services/priceFormat';

export interface SignalItem {
  title: string;
  price: number;
  size?: number;
  valueUsd?: number;
  side?: string;
  description?: string;
  time?: number;
}

export interface TooltipData {
  x: number;
  y: number;
  barX?: number;
  barWidth?: number;
  type: 'candle' | 'cell' | 'signal';
  title: string;
  price?: number;
  tickSize?: number;
  time?: number;
  // Candle data
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  delta?: number;
  minDelta?: number;
  maxDelta?: number;
  poc?: number;
  // Cell data
  bidVol?: number;
  askVol?: number;
  cellDelta?: number;
  hasBidImbalance?: boolean;
  hasAskImbalance?: boolean;
  hasStackedBidImbalance?: boolean;
  hasStackedAskImbalance?: boolean;
  isPOC?: boolean;
  // Signal data
  signalType?: string;
  size?: number;
  valueUsd?: number;
  side?: string;
  description?: string;
  clusterSignals?: SignalItem[];
}

interface ChartTooltipProps {
  data: TooltipData | null;
  containerWidth: number;
  containerHeight: number;
}

export const ChartTooltip: React.FC<ChartTooltipProps> = ({
  data,
  containerWidth,
  containerHeight,
}) => {
  if (!data) return null;

  const tickSize = data.tickSize || 0.25;

  // Collision-aware positioning: never block active candle ladder or price axis
  const tooltipWidth = 164;
  const tooltipHeight = data.type === 'candle' ? 140 : (data.type === 'cell' ? 136 : 120);

  const gutterRight = containerWidth - 76;
  const candleLeft = data.barX !== undefined ? data.barX : (data.x - 35);
  const candleWidth = data.barWidth !== undefined ? data.barWidth : 70;
  const candleRight = candleLeft + candleWidth;

  // Preferred behavior:
  // 1. Try slightly to the right of the active candle
  let left = candleRight + 8;

  // 2. If it would overlap or exceed the price gutter on right, move to left of candle
  if (left + tooltipWidth > gutterRight) {
    left = candleLeft - tooltipWidth - 8;
  }

  // 3. If there is insufficient space on left either, clamp to visible pocket
  if (left < 6) {
    if (candleLeft > (gutterRight - candleRight)) {
      left = Math.max(6, candleLeft - tooltipWidth - 6);
    } else {
      left = Math.min(gutterRight - tooltipWidth - 6, candleRight + 6);
    }
  }

  // Vertical placement: keep inside chart area and avoid overflowing bottom axis
  let top = data.y - 18;
  if (top + tooltipHeight > containerHeight - 42) {
    top = Math.max(8, containerHeight - 42 - tooltipHeight);
  }
  if (top < 8) {
    top = 8;
  }

  return (
    <div
      className="chart-hud-tooltip select-none"
      style={{
        left: `${left}px`,
        top: `${top}px`,
      }}
    >
      <div className="hud-title flex items-center justify-between text-[#22D3EE]">
        <span>{data.title}</span>
        {data.time && (
          <span className="text-[#7F8B97] font-normal text-[9px]">
            {new Date(data.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        )}
      </div>

      {data.type === 'candle' && (
        <div className="flex flex-col gap-1 text-[10px]">
          <div className="hud-row">
            <span className="hud-label">O / C:</span>
            <span className="hud-value text-[#E7EDF3]">
              {data.open ? formatPrice(data.open, tickSize) : '—'} / {data.close ? formatPrice(data.close, tickSize) : '—'}
            </span>
          </div>
          <div className="hud-row">
            <span className="hud-label">H / L:</span>
            <span className="hud-value text-[#E7EDF3]">
              {data.high ? formatPrice(data.high, tickSize) : '—'} / {data.low ? formatPrice(data.low, tickSize) : '—'}
            </span>
          </div>
          <div className="hud-row">
            <span className="hud-label">Volume:</span>
            <span className="hud-value text-[#E7EDF3]">
              {data.volume ? formatVolume(data.volume) : '0'}
            </span>
          </div>
          <div className="hud-row">
            <span className="hud-label">Delta:</span>
            <span className={`hud-value ${(data.delta ?? 0) >= 0 ? 'text-[#19C37D]' : 'text-[#F05252]'}`}>
              {(data.delta ?? 0) >= 0 ? '+' : ''}{data.delta ? formatVolume(data.delta) : '0'}
            </span>
          </div>
          {data.poc && (
            <div className="hud-row">
              <span className="hud-label text-[#F5B942]">POC:</span>
              <span className="hud-value text-[#F5B942]">
                {formatPrice(data.poc, tickSize)}
              </span>
            </div>
          )}
          {data.minDelta !== undefined && data.maxDelta !== undefined && (
            <div className="hud-row text-[9px] text-[#7F8B97]">
              <span className="hud-label">Min / Max Δ:</span>
              <span className="hud-value">
                [{data.minDelta.toFixed(0)} / {data.maxDelta.toFixed(0)}]
              </span>
            </div>
          )}
        </div>
      )}

      {data.type === 'cell' && (
        <div className="flex flex-col gap-1 text-[10px]">
          <div className="hud-row">
            <span className="hud-label">Price:</span>
            <span className="hud-value text-[#F5B942] font-bold">
              {data.price !== undefined ? formatPrice(data.price, tickSize) : '—'}
            </span>
          </div>
          <div className="hud-row">
            <span className="hud-label">Bid:</span>
            <span className="hud-value text-[#F05252] font-semibold">
              {data.bidVol !== undefined ? formatVolume(data.bidVol) : '0'}
            </span>
          </div>
          <div className="hud-row">
            <span className="hud-label">Ask:</span>
            <span className="hud-value text-[#19C37D] font-semibold">
              {data.askVol !== undefined ? formatVolume(data.askVol) : '0'}
            </span>
          </div>
          <div className="hud-row">
            <span className="hud-label">Delta:</span>
            <span className={`hud-value font-semibold ${(data.cellDelta ?? 0) >= 0 ? 'text-[#19C37D]' : 'text-[#F05252]'}`}>
              {(data.cellDelta ?? 0) >= 0 ? '+' : ''}{data.cellDelta !== undefined ? formatVolume(data.cellDelta) : '0'}
            </span>
          </div>
          <div className="hud-row">
            <span className="hud-label">Volume:</span>
            <span className="hud-value text-[#E7EDF3]">
              {formatVolume((data.bidVol ?? 0) + (data.askVol ?? 0))}
            </span>
          </div>
          <div className="hud-row">
            <span className="hud-label">Ratio:</span>
            <span className="hud-value text-[#94A3B8] font-mono">
              {(() => {
                const b = data.bidVol ?? 0;
                const a = data.askVol ?? 0;
                if (b > 0 && a > 0) {
                  return a >= b ? `${(a / b).toFixed(1)}x Ask` : `${(b / a).toFixed(1)}x Bid`;
                }
                if (a > 0) return 'Ask only';
                if (b > 0) return 'Bid only';
                return '—';
              })()}
            </span>
          </div>

          {data.isPOC && (
            <div className="hud-row text-[9px] mt-0.5 pt-0.5 border-t border-[#1C2630]">
              <span className="hud-label text-[#F5B942]">POC:</span>
              <span className="hud-value text-[#F5B942] font-bold">Point of Control</span>
            </div>
          )}

          {(data.hasBidImbalance || data.hasAskImbalance) && (
            <div className="hud-row text-[9px] mt-0.5 pt-0.5 border-t border-[#1C2630]">
              <span className="hud-label">Imbalance:</span>
              <span className={`hud-value font-semibold ${data.hasAskImbalance ? 'text-[#19C37D]' : 'text-[#F05252]'}`}>
                {data.hasAskImbalance ? 'Buy Imbalance (Ask)' : 'Sell Imbalance (Bid)'}
              </span>
            </div>
          )}

          {(data.hasStackedBidImbalance || data.hasStackedAskImbalance) && (
            <div className="hud-row text-[9px] mt-0.5">
              <span className="hud-label">Stacked:</span>
              <span className={`hud-value font-bold ${data.hasStackedAskImbalance ? 'text-[#19C37D]' : 'text-[#F05252]'}`}>
                {data.hasStackedAskImbalance ? 'Stacked Buy Imbalance' : 'Stacked Sell Imbalance'}
              </span>
            </div>
          )}
        </div>
      )}


      {data.type === 'signal' && (
        <div className="flex flex-col gap-1.5 text-[10px]">
          {data.clusterSignals && data.clusterSignals.length > 0 ? (
            <div className="flex flex-col gap-2">
              {data.clusterSignals.map((sig, idx) => (
                <div key={idx} className="flex flex-col gap-0.5 pb-1.5 border-b border-[#1C2630] last:border-b-0 last:pb-0">
                  <div className="flex items-center justify-between text-[#22D3EE] font-semibold">
                    <span>{sig.title}</span>
                    <span className="text-[#F5B942]">{formatPrice(sig.price, tickSize)}</span>
                  </div>
                  {sig.size !== undefined && (
                    <div className="hud-row">
                      <span className="hud-label">Volume:</span>
                      <span className="hud-value text-[#E7EDF3]">{formatVolume(sig.size)} contracts</span>
                    </div>
                  )}
                  {sig.valueUsd !== undefined && (
                    <div className="hud-row">
                      <span className="hud-label">Notional:</span>
                      <span className="hud-value text-[#38BDF8]">${(sig.valueUsd / 1_000_000).toFixed(2)}M</span>
                    </div>
                  )}
                  {sig.side && (
                    <div className="hud-row">
                      <span className="hud-label">Side:</span>
                      <span className={`hud-value ${sig.side.toLowerCase().includes('buy') ? 'text-[#19C37D]' : 'text-[#F05252]'}`}>
                        {sig.side}
                      </span>
                    </div>
                  )}
                  {sig.description && (
                    <div className="text-[9px] text-[#7F8B97] mt-0.5">{sig.description}</div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className="hud-row">
                <span className="hud-label">Price:</span>
                <span className="hud-value text-[#F5B942]">
                  {data.price ? formatPrice(data.price, tickSize) : '—'}
                </span>
              </div>
              {data.size !== undefined && (
                <div className="hud-row">
                  <span className="hud-label">Size:</span>
                  <span className="hud-value text-[#E7EDF3]">
                    {formatVolume(data.size)} contracts
                  </span>
                </div>
              )}
              {data.valueUsd !== undefined && (
                <div className="hud-row">
                  <span className="hud-label">Notional:</span>
                  <span className="hud-value text-[#22D3EE]">
                    ${(data.valueUsd / 1_000_000).toFixed(2)}M
                  </span>
                </div>
              )}
              {data.side && (
                <div className="hud-row">
                  <span className="hud-label">Aggressor:</span>
                  <span className={`hud-value ${data.side.toLowerCase().includes('buy') ? 'text-[#19C37D]' : 'text-[#F05252]'}`}>
                    {data.side.toUpperCase()}
                  </span>
                </div>
              )}
              {data.description && (
                <div className="text-[9px] text-[#7F8B97] mt-1 pt-1 border-t border-[#1C2630]">
                  {data.description}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

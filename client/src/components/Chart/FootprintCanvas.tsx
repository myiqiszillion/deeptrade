import React, { useEffect, useRef, useState, useCallback } from 'react';
import { AbsorptionAlert, ChartViewport, DeepTrade, FootprintBar, GEXProfile, HistoricalBar, VWAPPoint } from '../../types';
import { historyBeforeLive } from '../../services/chartHistory';
import { formatPrice } from '../../services/priceFormat';
import {
  calculatePriceToY,
  calculateYToPrice,
  clampScale,
} from '../../services/viewportMath';

interface FootprintCanvasProps {
  bars: FootprintBar[];
  /**
   * REAL vendor bars that preceded the live session. Rendered as plain candles to the LEFT of
   * the live footprint, because a bar carries no per-price bid/ask split — there is nothing
   * honest to draw inside them.
   */
  historyBars?: HistoricalBar[];
  currentPrice: number;
  vwapPoints: VWAPPoint[];
  deepTrades: DeepTrade[];
  absorptions: AbsorptionAlert[];
  gexProfile?: GEXProfile;
  showVWAP: boolean;
  showImbalances: boolean;
  showDeltaNumbers: boolean;
  tickSize?: number;
  symbol?: string;
  timeframe?: string;
  isLive?: boolean;
  sessionMode?: 'LIVE' | 'REPLAY' | 'REPLAY_PAUSED' | 'REPLAY_ENDED';
  chartMode?: 'footprint' | 'candles';
  viewport?: ChartViewport;
  onViewportChange?: (vp: ChartViewport) => void;
  crosshairX?: number | null;
  onCrosshairChange?: (x: number | null) => void;
}

export const FootprintCanvas: React.FC<FootprintCanvasProps> = ({
  bars,
  historyBars,
  currentPrice,
  vwapPoints,
  deepTrades,
  absorptions,
  gexProfile,
  showVWAP,
  showImbalances,
  showDeltaNumbers,
  tickSize = 0.5,
  symbol,
  timeframe,
  isLive = false,
  sessionMode = 'LIVE',
  chartMode = 'footprint',
  viewport: propsViewport,
  onViewportChange,
  crosshairX,
  onCrosshairChange,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Viewport / Camera fallback state
  const [internalViewport, setInternalViewport] = useState<ChartViewport>({
    panX: 0,
    panY: 0,
    barWidth: 80,
    barSpacing: 20,
    priceScale: 6,
    autoFollow: true,
  });

  const viewport = propsViewport || internalViewport;

  // Cache ref to prevent stale closures in event listeners
  const viewportRef = useRef(viewport);
  const currentPriceRef = useRef<number>(currentPrice);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  useEffect(() => {
    currentPriceRef.current = currentPrice;
  }, [currentPrice]);

  const updateViewport = useCallback(
    (updater: (prev: ChartViewport) => ChartViewport) => {
      if (onViewportChange) {
        const next = updater(viewportRef.current);
        viewportRef.current = next;
        onViewportChange(next);
      } else {
        setInternalViewport(updater);
      }
    },
    [onViewportChange]
  );

  const autoFollow = viewport.autoFollow;
  const setAutoFollow = useCallback(
    (valOrFn: boolean | ((prev: boolean) => boolean)) => {
      updateViewport((prev) => {
        const currentVal = prev.autoFollow ?? true;
        const nextVal = typeof valOrFn === 'function' ? valOrFn(currentVal) : valOrFn;
        return { ...prev, autoFollow: nextVal };
      });
    },
    [updateViewport]
  );

  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const mousePosRef = useRef<{ x: number; y: number } | null>(null);
  const lastFittedDatasetRef = useRef<string | null>(null);

  // Manual or automatic fit of viewport: center price vertically, anchor on the right.
  const fitViewport = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cssWidth = canvas.parentElement?.clientWidth || 800;
    const cssHeight = canvas.parentElement?.clientHeight || 600;
    const anchor = currentPriceRef.current && currentPriceRef.current > 0
      ? currentPriceRef.current
      : (bars[bars.length - 1]?.close ?? historyBars?.[historyBars.length - 1]?.close ?? 100);
    const totalWidth = bars.length * (viewportRef.current.barWidth + viewportRef.current.barSpacing);
    const targetPanX = Math.min(cssWidth - 80, cssWidth - totalWidth - 80);
    updateViewport((prev) => ({
      ...prev,
      anchorPrice: anchor,
      panY: cssHeight / 2,
      panX: targetPanX,
      autoFollow: true,
    }));
  }, [bars, historyBars, updateViewport]);

  // Fit the viewport once per dataset switch (symbol, timeframe, or mode switch),
  // only after valid price/bars for the current dataset are present.
  useEffect(() => {
    if (!symbol) return;
    const isReplayMode = sessionMode ? sessionMode !== 'LIVE' : !isLive;
    const datasetKey = `${symbol}:${timeframe || ''}:${isReplayMode ? 'replay' : 'live'}`;
    if (lastFittedDatasetRef.current === datasetKey) return;

    const hasPrice = typeof currentPrice === 'number' && currentPrice > 0;
    const hasBars = bars.length > 0 || (historyBars && historyBars.length > 0);
    if (!hasPrice && !hasBars) return;

    lastFittedDatasetRef.current = datasetKey;
    fitViewport();
  }, [symbol, timeframe, sessionMode, isLive, bars.length, historyBars, currentPrice, fitViewport]);

  // Auto-follow: pin the newest bar near the right edge while enabled.
  useEffect(() => {
    if (!autoFollow) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cssWidth = canvas.parentElement?.clientWidth || 800;
    const totalWidth = bars.length * (viewport.barWidth + viewport.barSpacing);
    const nextPanX = cssWidth - totalWidth - 80;
    if (Math.abs(nextPanX - viewport.panX) > 1) {
      updateViewport((prev) => ({ ...prev, panX: nextPanX }));
    }
  }, [bars.length, autoFollow, viewport.barWidth, viewport.barSpacing, viewport.panX, updateViewport]);

  // Handle container resize without resetting user pan/zoom
  useEffect(() => {
    const parent = canvasRef.current?.parentElement;
    if (!parent) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        if (autoFollow) {
          const totalWidth = bars.length * (viewportRef.current.barWidth + viewportRef.current.barSpacing);
          updateViewport((prev) => ({ ...prev, panX: width - totalWidth - 80 }));
        }
      }
    });
    ro.observe(parent);
    return () => ro.disconnect();
  }, [autoFollow, bars.length, updateViewport]);

  // Mouse handlers for pan & zoom
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    isDraggingRef.current = true;
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: viewport.panX,
      panY: viewport.panY,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const curX = e.clientX - rect.left;
    const curY = e.clientY - rect.top;
    mousePosRef.current = {
      x: curX,
      y: curY,
    };
    if (onCrosshairChange) {
      onCrosshairChange(curX < canvas.clientWidth - 65 ? curX : null);
    }

    if (isDraggingRef.current) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      // Manual panning takes over from auto-follow atomically
      const shouldDisableFollow = autoFollow && (Math.abs(dx) > 3 || Math.abs(dy) > 3);
      updateViewport((prev) => ({
        ...prev,
        autoFollow: shouldDisableFollow ? false : prev.autoFollow,
        panX: dragStartRef.current.panX + dx,
        panY: dragStartRef.current.panY + dy,
      }));
    }
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const handleMouseLeave = () => {
    isDraggingRef.current = false;
    mousePosRef.current = null;
    if (onCrosshairChange) {
      onCrosshairChange(null);
    }
  };

  // Zoom on wheel (attached via non-passive native listener so preventDefault prevents page scrolling)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.shiftKey) {
        // Zoom Y (price scale)
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        updateViewport((prev) => ({
          ...prev,
          priceScale: clampScale(prev.priceScale, factor, 2, 25),
        }));
      } else {
        // Zoom X (bar width)
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        updateViewport((prev) => ({
          ...prev,
          barWidth: clampScale(prev.barWidth, factor, 40, 180),
        }));
      }
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [updateViewport]);

  // Convert Price to Canvas Y: anchored to viewport.anchorPrice so live ticks don't jump the chart
  const priceToY = useCallback(
    (price: number, _canvasHeight: number) => {
      const effectiveAnchor = viewport.anchorPrice ?? currentPriceRef.current;
      return calculatePriceToY(price, effectiveAnchor, viewport.panY, viewport.priceScale, tickSize);
    },
    [tickSize, viewport.anchorPrice, viewport.panY, viewport.priceScale]
  );

  // Convert Canvas Y to Price
  const yToPrice = useCallback(
    (y: number) => {
      const effectiveAnchor = viewport.anchorPrice ?? currentPriceRef.current;
      return calculateYToPrice(y, effectiveAnchor, viewport.panY, viewport.priceScale, tickSize);
    },
    [tickSize, viewport.anchorPrice, viewport.panY, viewport.priceScale]
  );

  // Main Render Loop
  useEffect(() => {
    let animationId: number;

    const render = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // High-DPI aware backing store: size the canvas in device pixels and draw in CSS
      // pixels so text and 1px lines stay crisp on retina/scaled displays.
      const cssWidth = canvas.parentElement?.clientWidth || 800;
      const cssHeight = canvas.parentElement?.clientHeight || 600;
      const dpr = window.devicePixelRatio || 1;
      const pixelWidth = Math.floor(cssWidth * dpr);
      const pixelHeight = Math.floor(cssHeight * dpr);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const width = cssWidth;
      const height = cssHeight;

      // 1. Clear background
      ctx.fillStyle = '#0c0e12';
      ctx.fillRect(0, 0, width, height);

      // 2. Draw Price Grid Lines
      const priceStep = Math.max(1, Math.round(15 / (viewport.priceScale / tickSize))) * tickSize * 5;
      const minVisiblePrice = yToPrice(height);
      const maxVisiblePrice = yToPrice(0);
      const startPrice = Math.floor(minVisiblePrice / priceStep) * priceStep;

      ctx.strokeStyle = '#1a1f2c';
      ctx.lineWidth = 1;
      ctx.fillStyle = '#64748b';
      ctx.font = '10px JetBrains Mono, monospace';

      for (let p = startPrice; p <= maxVisiblePrice; p += priceStep) {
        const y = priceToY(p, height);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width - 65, y);
        ctx.stroke();

        // Price label on right margin
        ctx.fillText(formatPrice(p, tickSize), width - 60, y + 3);
      }

      // 3. Draw VWAP and Bands
      if (showVWAP && vwapPoints.length > 0) {
        ctx.save();
        // VWAP Line (Gold)
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        let first = true;
        for (let i = 0; i < bars.length; i++) {
          const bar = bars[i];
          const vPoint = vwapPoints.find((v) => Math.abs(v.time - bar.time) < 60000);
          if (vPoint) {
            const barX = viewport.panX + i * (viewport.barWidth + viewport.barSpacing) + viewport.barWidth / 2;
            const barY = priceToY(vPoint.vwap, height);
            if (first) {
              ctx.moveTo(barX, barY);
              first = false;
            } else {
              ctx.lineTo(barX, barY);
            }
          }
        }
        ctx.stroke();

        // Upper & Lower Bands (Dashed Light Blue)
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);

        // Upper 1
        ctx.beginPath();
        first = true;
        for (let i = 0; i < bars.length; i++) {
          const bar = bars[i];
          const vPoint = vwapPoints.find((v) => Math.abs(v.time - bar.time) < 60000);
          if (vPoint) {
            const barX = viewport.panX + i * (viewport.barWidth + viewport.barSpacing) + viewport.barWidth / 2;
            const barY = priceToY(vPoint.upper1, height);
            if (first) { ctx.moveTo(barX, barY); first = false; } else { ctx.lineTo(barX, barY); }
          }
        }
        ctx.stroke();

        // Lower 1
        ctx.beginPath();
        first = true;
        for (let i = 0; i < bars.length; i++) {
          const bar = bars[i];
          const vPoint = vwapPoints.find((v) => Math.abs(v.time - bar.time) < 60000);
          if (vPoint) {
            const barX = viewport.panX + i * (viewport.barWidth + viewport.barSpacing) + viewport.barWidth / 2;
            const barY = priceToY(vPoint.lower1, height);
            if (first) { ctx.moveTo(barX, barY); first = false; } else { ctx.lineTo(barX, barY); }
          }
        }
        ctx.stroke();
        ctx.restore();
      }

      // 4. Draw REAL historical candles.
      //
      // History occupies NEGATIVE bar indices so the live footprint always begins at index 0 and
      // the two can never overlap or be mistaken for one another. They are drawn filled + dimmed
      // (live footprint bars are outlined + bright) and carry no footprint cells, because a bar
      // aggregate simply does not contain a per-price bid/ask split.
      const history = historyBeforeLive(historyBars ?? [], bars);
      if (history.length > 0) {
        ctx.save();
        ctx.globalAlpha = 0.4;
        for (let i = 0; i < history.length; i++) {
          const bar = history[i];
          const barIndex = i - history.length; // negative => strictly left of the live bars
          const barX = viewport.panX + barIndex * (viewport.barWidth + viewport.barSpacing);
          if (barX + viewport.barWidth < 0 || barX > width - 65) continue;

          const color = bar.close >= bar.open ? '#00c087' : '#f6465d';
          const highY = priceToY(bar.high, height);
          const lowY = priceToY(bar.low, height);
          const openY = priceToY(bar.open, height);
          const closeY = priceToY(bar.close, height);

          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(barX + viewport.barWidth / 2, highY);
          ctx.lineTo(barX + viewport.barWidth / 2, lowY);
          ctx.stroke();

          const bodyTop = Math.min(openY, closeY);
          ctx.fillStyle = color;
          ctx.fillRect(barX + 2, bodyTop, viewport.barWidth - 4, Math.max(1, Math.abs(closeY - openY)));
          ctx.fillStyle = '#94a3b8';
          ctx.font = '9px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(new Date(bar.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            barX + viewport.barWidth / 2, height - 8);
        }

        // Mark the boundary: left of this line is real history WITHOUT footprint detail, right of
        // it is built from real ticks. The distinction is the product's core claim, so it is drawn
        // rather than left to the provenance strip alone.
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(viewport.panX, 0);
        ctx.lineTo(viewport.panX, height);
        ctx.stroke();
        ctx.setLineDash([]);

        const boundaryLabelX = viewport.panX + 6;
        if (boundaryLabelX >= 0 && boundaryLabelX < width - 65) {
          ctx.textAlign = 'left';
          ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
          ctx.font = '9px monospace';
          ctx.fillText('real bars (no footprint) | live ticks', boundaryLabelX, 12);
        }
        ctx.restore();
      }

      // 5. Draw Footprint Bars / Candlesticks
      const levelHeight = viewport.priceScale;

      bars.forEach((bar, barIndex) => {
        const barX = viewport.panX + barIndex * (viewport.barWidth + viewport.barSpacing);

        // Cull bars outside visible canvas
        if (barX + viewport.barWidth < 0 || barX > width - 65) return;

        const isUp = bar.close >= bar.open;
        const candleColor = isUp ? '#00c087' : '#f6465d';

        // Candle Wick
        const highY = priceToY(bar.high, height);
        const lowY = priceToY(bar.low, height);
        ctx.strokeStyle = candleColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(barX + viewport.barWidth / 2, highY);
        ctx.lineTo(barX + viewport.barWidth / 2, lowY);
        ctx.stroke();

        // Candle Body Outline / Fill
        const openY = priceToY(bar.open, height);
        const closeY = priceToY(bar.close, height);
        const bodyTop = Math.min(openY, closeY);
        const bodyHeight = Math.max(2, Math.abs(closeY - openY));

        if (chartMode === 'candles') {
          // Solid Candlestick Body
          ctx.fillStyle = candleColor;
          ctx.fillRect(barX + 4, bodyTop, viewport.barWidth - 8, bodyHeight);
          ctx.strokeStyle = candleColor;
          ctx.strokeRect(barX + 4, bodyTop, viewport.barWidth - 8, bodyHeight);

          // POC Marker Line
          const pocPrice = Object.keys(bar.levels).find((p) => bar.levels[Number(p)]?.isPOC);
          if (pocPrice) {
            const pocY = priceToY(Number(pocPrice), height);
            ctx.strokeStyle = '#f0b90b';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(barX + 2, pocY);
            ctx.lineTo(barX + viewport.barWidth - 2, pocY);
            ctx.stroke();
          }
        } else {
          // Footprint Body Outline
          ctx.strokeStyle = candleColor;
          ctx.strokeRect(barX + 2, bodyTop, viewport.barWidth - 4, bodyHeight);

          // Footprint Price Levels (Clusters)
          const cellWidth = (viewport.barWidth - 4) / 2;
          const sortedPrices = Object.keys(bar.levels)
            .map(Number)
            .sort((a, b) => b - a); // Top down

          sortedPrices.forEach((price) => {
            const level = bar.levels[price];
            const y = priceToY(price, height) - levelHeight / 2;

            // Bid Cell (Left) - Market Sells
            const bidIntensity = Math.min(1, level.bidVol / (bar.volume * 0.1 || 1));
            ctx.fillStyle = level.bidImbalance && showImbalances
              ? 'rgba(239, 68, 68, 0.45)' // Highlighted Sell Imbalance
              : `rgba(246, 70, 93, ${0.1 + bidIntensity * 0.4})`;
            ctx.fillRect(barX + 2, y, cellWidth, levelHeight - 1);

            // Ask Cell (Right) - Market Buys
            const askIntensity = Math.min(1, level.askVol / (bar.volume * 0.1 || 1));
            ctx.fillStyle = level.askImbalance && showImbalances
              ? 'rgba(16, 185, 129, 0.45)' // Highlighted Buy Imbalance
              : `rgba(0, 192, 135, ${0.1 + askIntensity * 0.4})`;
            ctx.fillRect(barX + 2 + cellWidth, y, cellWidth, levelHeight - 1);

            // Imbalance Accent Border
            if (showImbalances) {
              if (level.bidImbalance) {
                ctx.strokeStyle = '#f59e0b';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(barX + 2, y, cellWidth, levelHeight - 1);
              }
              if (level.askImbalance) {
                ctx.strokeStyle = '#10b981';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(barX + 2 + cellWidth, y, cellWidth, levelHeight - 1);
              }
            }

            // POC Marker (Gold Outline)
            if (level.isPOC) {
              ctx.strokeStyle = '#f0b90b';
              ctx.lineWidth = 1.5;
              ctx.strokeRect(barX + 2, y, viewport.barWidth - 4, levelHeight - 1);
            }

            // Numbers inside cells (if barWidth is large enough)
            if (viewport.barWidth >= 70 && levelHeight >= 11) {
              ctx.font = `${Math.min(9, levelHeight - 2)}px JetBrains Mono, monospace`;
              
              // Bid Text
              ctx.fillStyle = level.bidImbalance ? '#fca5a5' : '#e2e8f0';
              ctx.textAlign = 'right';
              ctx.fillText(level.bidVol.toFixed(1), barX + cellWidth - 2, y + levelHeight - 3);

              // Ask Text
              ctx.fillStyle = level.askImbalance ? '#6ee7b7' : '#e2e8f0';
              ctx.textAlign = 'left';
              ctx.fillText(level.askVol.toFixed(1), barX + cellWidth + 4, y + levelHeight - 3);
            }
          });
        }

        // Unfinished Auction indicators
        if (bar.unfinishedHigh) {
          ctx.fillStyle = '#00c087';
          ctx.beginPath();
          ctx.arc(barX + viewport.barWidth / 2, highY - 4, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        if (bar.unfinishedLow) {
          ctx.fillStyle = '#f6465d';
          ctx.beginPath();
          ctx.arc(barX + viewport.barWidth / 2, lowY + 4, 3, 0, Math.PI * 2);
          ctx.fill();
        }

        // Bottom Delta Info
        if (showDeltaNumbers) {
          const infoY = height - 25;
          ctx.fillStyle = bar.delta >= 0 ? '#10b981' : '#ef4444';
          ctx.font = 'bold 9px JetBrains Mono, monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`Δ ${bar.delta >= 0 ? '+' : ''}${bar.delta.toFixed(1)}`, barX + viewport.barWidth / 2, infoY);

          ctx.fillStyle = '#64748b';
          ctx.font = '8px JetBrains Mono, monospace';
          ctx.fillText(`[${bar.minDelta.toFixed(0)}/${bar.maxDelta.toFixed(0)}]`, barX + viewport.barWidth / 2, infoY + 12);
        }
      });

      // 5. Draw Absorptions
      absorptions.forEach((abs) => {
        const y = priceToY(abs.price, height);
        ctx.fillStyle = abs.side === 'buy_absorption' ? '#8b5cf6' : '#ec4899';
        ctx.beginPath();
        ctx.arc(width - 80, y, 6, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 9px JetBrains Mono, monospace';
        ctx.textAlign = 'right';
        ctx.fillText(
          `${abs.side === 'buy_absorption' ? 'BUY ABS' : 'SELL ABS'} ${abs.volume.toFixed(0)}`,
          width - 90,
          y + 3
        );
      });

      // 5.1 Draw Deep Trades (whales) as filled diamonds in the gutter, left of the axis
      deepTrades.forEach((dt) => {
        const y = priceToY(dt.price, height);
        // Kept clear of the price labels drawn at width-60 so neither is obscured.
        const x = width - 66;
        const r = 6;

        ctx.fillStyle = dt.side === 'buy' ? '#22c55e' : '#ef4444';
        ctx.beginPath();
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r, y);
        ctx.lineTo(x, y + r);
        ctx.lineTo(x - r, y);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = '#0c0e12';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 9px JetBrains Mono, monospace';
        ctx.textAlign = 'right';
        ctx.fillText(
          `${dt.side === 'buy' ? 'BUY' : 'SELL'} ${dt.size} ($${(dt.valueUsd / 1_000_000).toFixed(2)}M)`,
          width - 76,
          y + 3
        );
      });

      // 5.1 Draw GEX Levels (Call Wall, Put Wall, Zero Gamma)
      if (gexProfile) {
        ctx.save();
        ctx.setLineDash([4, 4]);

        // Call Wall (Resistance)
        const cwY = priceToY(gexProfile.callWall, height);
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, cwY);
        ctx.lineTo(width - 65, cwY);
        ctx.stroke();
        ctx.fillStyle = '#10b981';
        ctx.font = 'bold 9px JetBrains Mono, monospace';
        ctx.fillText(`CALL WALL ${gexProfile.callWall}`, 10, cwY - 4);

        // Put Wall (Support)
        const pwY = priceToY(gexProfile.putWall, height);
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, pwY);
        ctx.lineTo(width - 65, pwY);
        ctx.stroke();
        ctx.fillStyle = '#ef4444';
        ctx.font = 'bold 9px JetBrains Mono, monospace';
        ctx.fillText(`PUT WALL ${gexProfile.putWall}`, 10, pwY - 4);

        // Zero Gamma Flip
        const zgY = priceToY(gexProfile.zeroGammaFlip, height);
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, zgY);
        ctx.lineTo(width - 65, zgY);
        ctx.stroke();
        ctx.fillStyle = '#f59e0b';
        ctx.font = 'bold 9px JetBrains Mono, monospace';
        ctx.fillText(`ZERO GAMMA ${gexProfile.zeroGammaFlip}`, 10, zgY - 4);

        ctx.restore();
      }

      // 6. Draw Current Price Line (Dashed Orange)
      const curY = priceToY(currentPrice, height);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(0, curY);
      ctx.lineTo(width - 65, curY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Current Price Badge
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(width - 65, curY - 10, 65, 20);
      ctx.fillStyle = '#0c0e12';
      ctx.font = 'bold 10px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(formatPrice(currentPrice, tickSize), width - 60, curY + 4);
      if (!isLive) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px monospace';
        ctx.fillText('Historical / last observed price - live feed unavailable', 10, 25);
      }

      // 7. Crosshair
      const activeX = crosshairX ?? mousePosRef.current?.x;
      const activeY = mousePosRef.current?.y;

      if (activeX !== null && activeX !== undefined && activeX < width - 65) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);

        // Vertical
        ctx.beginPath();
        ctx.moveTo(activeX, 0);
        ctx.lineTo(activeX, height);
        ctx.stroke();

        // Horizontal & Price Label
        if (activeY !== undefined && activeY < height) {
          ctx.beginPath();
          ctx.moveTo(0, activeY);
          ctx.lineTo(width - 65, activeY);
          ctx.stroke();

          // Hover Price Label
          const hoverPrice = yToPrice(activeY);
          ctx.fillStyle = '#334155';
          ctx.fillRect(width - 65, activeY - 9, 65, 18);
          ctx.fillStyle = '#f1f5f9';
          ctx.font = '9px JetBrains Mono, monospace';
          ctx.fillText(formatPrice(hoverPrice, tickSize), width - 60, activeY + 4);
        }
        ctx.setLineDash([]);
      }

      animationId = requestAnimationFrame(render);
    };

    animationId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationId);
  }, [
    bars,
    historyBars,
    isLive,
    currentPrice,
    vwapPoints,
    deepTrades,
    absorptions,
    showVWAP,
    showImbalances,
    showDeltaNumbers,
    tickSize,
    viewport,
    gexProfile,
    priceToY,
    yToPrice,
    chartMode,
    crosshairX,
  ]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-brand-bg select-none">
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        className="w-full h-full cursor-crosshair block"
      />

      {/* Legend for the markers that are drawn on top of the ladder */}
      <div className="absolute top-2 left-2 flex items-center gap-2 text-[9px] font-mono pointer-events-none">
        <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
          BUY ABSORPTION
        </span>
        <span className="px-1.5 py-0.5 rounded bg-pink-500/20 text-pink-300 border border-pink-500/30">
          SELL ABSORPTION
        </span>
        <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
          CALL WALL / PUT WALL / ZERO GAMMA
        </span>
        <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
          &#9670; WHALE (DEEP TRADE)
        </span>
      </div>

      {/* Viewport Controls: Fit View and Auto-follow toggle */}
      <div className="absolute top-2 right-20 flex items-center gap-1.5 select-none">
        <button
          onClick={fitViewport}
          title="Reset View and Fit to Price"
          className="px-2 py-0.5 rounded text-[9px] font-mono border bg-slate-700/40 text-slate-300 border-slate-600 hover:bg-slate-600/50 hover:text-white transition-colors"
        >
          FIT VIEW
        </button>
        <button
          onClick={() => setAutoFollow((v) => !v)}
          title="Keep the newest bar pinned to the right edge"
          className={`px-2 py-0.5 rounded text-[9px] font-mono border transition-colors ${
            autoFollow
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30'
              : 'bg-slate-700/40 text-slate-300 border-slate-600 hover:bg-slate-600/50'
          }`}
        >
          {autoFollow ? 'FOLLOW ON' : 'FOLLOW OFF'}
        </button>
      </div>
    </div>
  );
};

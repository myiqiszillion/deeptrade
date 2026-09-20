import React, { useEffect, useRef, useState, useCallback } from 'react';
import { AbsorptionAlert, DeepTrade, FootprintBar, GEXProfile, VWAPPoint } from '../../types';

interface FootprintCanvasProps {
  bars: FootprintBar[];
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
}

export const FootprintCanvas: React.FC<FootprintCanvasProps> = ({
  bars,
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
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // When enabled the newest bar stays pinned to the right edge of the viewport.
  const [autoFollow, setAutoFollow] = useState(true);

  // Viewport / Camera state
  const [viewport, setViewport] = useState({
    panX: 0,
    panY: 0,
    barWidth: 80, // pixels per bar
    barSpacing: 20,
    priceScale: 6, // pixels per tick
  });

  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const mousePosRef = useRef<{ x: number; y: number } | null>(null);

  // Fit the viewport once per instrument: centre price vertically, anchor on the right.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cssWidth = canvas.parentElement?.clientWidth || 800;
    const cssHeight = canvas.parentElement?.clientHeight || 600;
    setViewport((prev) => ({ ...prev, panY: cssHeight / 2, panX: cssWidth - 80 }));
  }, [symbol]);

  // Auto-follow: pin the newest bar near the right edge while enabled.
  useEffect(() => {
    if (!autoFollow) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cssWidth = canvas.parentElement?.clientWidth || 800;
    const totalWidth = bars.length * (viewport.barWidth + viewport.barSpacing);
    setViewport((prev) => {
      const nextPanX = cssWidth - totalWidth - 80;
      return nextPanX === prev.panX ? prev : { ...prev, panX: nextPanX };
    });
  }, [bars.length, autoFollow, viewport.barWidth, viewport.barSpacing]);

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
    mousePosRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };

    if (isDraggingRef.current) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      // Manual panning takes over from auto-follow until the user re-enables it.
      if (autoFollow) setAutoFollow(false);
      setViewport((prev) => ({
        ...prev,
        panX: dragStartRef.current.panX + dx,
        panY: dragStartRef.current.panY + dy,
      }));
    }
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (e.shiftKey) {
      // Zoom Y (price scale)
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      setViewport((prev) => ({
        ...prev,
        priceScale: Math.max(2, Math.min(25, prev.priceScale * factor)),
      }));
    } else {
      // Zoom X (bar width)
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      setViewport((prev) => ({
        ...prev,
        barWidth: Math.max(40, Math.min(180, prev.barWidth * factor)),
      }));
    }
  };

  // Convert Price to Canvas Y
  const priceToY = useCallback(
    (price: number, _canvasHeight: number) => {
      // Vertical anchoring is driven by viewport.panY (set on fit + drag), so the
      // canvas height is intentionally not part of the mapping.
      const priceDiff = price - currentPrice;
      const ticks = priceDiff / tickSize;
      return viewport.panY - ticks * viewport.priceScale;
    },
    [currentPrice, tickSize, viewport.panY, viewport.priceScale]
  );

  // Convert Canvas Y to Price
  const yToPrice = useCallback(
    (y: number) => {
      const diffY = viewport.panY - y;
      const ticks = diffY / viewport.priceScale;
      return Math.round((currentPrice + ticks * tickSize) / tickSize) * tickSize;
    },
    [currentPrice, tickSize, viewport.panY, viewport.priceScale]
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
        ctx.fillText(p.toFixed(1), width - 60, y + 3);
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

      // 4. Draw Footprint Bars
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

        // Candle Body Outline
        const openY = priceToY(bar.open, height);
        const closeY = priceToY(bar.close, height);
        const bodyTop = Math.min(openY, closeY);
        const bodyHeight = Math.max(2, Math.abs(closeY - openY));
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
      ctx.fillText(currentPrice.toFixed(1), width - 60, curY + 4);

      // 7. Crosshair
      if (mousePosRef.current) {
        const { x, y } = mousePosRef.current;
        if (x < width - 65 && y < height) {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 2]);

          // Vertical
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
          ctx.stroke();

          // Horizontal
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(width - 65, y);
          ctx.stroke();
          ctx.setLineDash([]);

          // Hover Price Label
          const hoverPrice = yToPrice(y);
          ctx.fillStyle = '#334155';
          ctx.fillRect(width - 65, y - 9, 65, 18);
          ctx.fillStyle = '#f1f5f9';
          ctx.font = '9px JetBrains Mono, monospace';
          ctx.fillText(hoverPrice.toFixed(1), width - 60, y + 4);
        }
      }

      animationId = requestAnimationFrame(render);
    };

    animationId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationId);
  }, [
    bars,
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
  ]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-brand-bg select-none">
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
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

      {/* Auto-follow toggle: drag the chart to disable, press to re-enable */}
      <button
        onClick={() => setAutoFollow((v) => !v)}
        title="Keep the newest bar pinned to the right edge"
        className={`absolute top-2 right-20 px-2 py-0.5 rounded text-[9px] font-mono border ${
          autoFollow
            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
            : 'bg-slate-700/40 text-slate-300 border-slate-600'
        }`}
      >
        {autoFollow ? 'FOLLOW ON' : 'FOLLOW OFF'}
      </button>
    </div>
  );
};

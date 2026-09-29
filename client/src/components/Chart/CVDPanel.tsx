import React, { useEffect, useRef } from 'react';
import { ChartViewport, FootprintBar, HistoricalBar } from '../../types';
import { historyBeforeLive } from '../../services/chartHistory';

interface CVDPanelProps {
  bars: FootprintBar[];
  historyBars?: HistoricalBar[];
  currentCVD: number;
  viewport?: ChartViewport;
  crosshairX?: number | null;
  onViewportChange?: (vp: ChartViewport) => void;
  onCrosshairChange?: (x: number | null) => void;
  height?: number;
  onHeightChange?: (h: number) => void;
  onClose?: () => void;
}

const GUTTER_WIDTH = 76;

export const CVDPanel: React.FC<CVDPanelProps> = ({
  bars,
  historyBars = [],
  currentCVD,
  viewport,
  crosshairX,
  onViewportChange,
  onCrosshairChange,
  height = 80,
  onHeightChange,
  onClose,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, panX: 0 });

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!viewport) return;
    isDraggingRef.current = true;
    dragStartRef.current = {
      x: e.clientX,
      panX: viewport.panX,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const curX = e.clientX - rect.left;
    if (onCrosshairChange) {
      onCrosshairChange(curX < canvas.clientWidth - GUTTER_WIDTH ? curX : null);
    }
    if (isDraggingRef.current && viewport && onViewportChange) {
      const dx = e.clientX - dragStartRef.current.x;
      onViewportChange({
        ...viewport,
        autoFollow: false,
        panX: dragStartRef.current.panX + dx,
      });
    }
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const handleMouseLeave = () => {
    isDraggingRef.current = false;
    if (onCrosshairChange) {
      onCrosshairChange(null);
    }
  };

  // Zoom on wheel (adjusts bar width)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      if (!viewport || !onViewportChange) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.08 : 0.92;
      onViewportChange({
        ...viewport,
        barWidth: Math.max(35, Math.min(200, viewport.barWidth * factor)),
      });
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [viewport, onViewportChange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cssWidth = canvas.parentElement?.clientWidth || 600;
    const cssHeight = canvas.parentElement?.clientHeight || 110;
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
    const chartWidth = width - GUTTER_WIDTH;

    // Background #080B0F
    ctx.fillStyle = '#080B0F';
    ctx.fillRect(0, 0, width, height);

    // Right Gutter #0B0F14
    ctx.fillStyle = '#0B0F14';
    ctx.fillRect(chartWidth, 0, GUTTER_WIDTH, height);
    ctx.strokeStyle = '#1C2630';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(chartWidth, 0);
    ctx.lineTo(chartWidth, height);
    ctx.stroke();

    const history = historyBeforeLive(historyBars, bars);
    const hasLiveBars = bars.length > 0;
    const hasHistoryBars = history.length > 0;
    if (!hasLiveBars && !hasHistoryBars) return;

    interface RenderBar {
      delta: number;
      cvd: number;
      barIndex: number;
    }

    const renderBars: RenderBar[] = [];
    let runningCvd = 0;

    // Process history bars
    if (hasHistoryBars) {
      history.forEach((hb, i) => {
        const delta =
          hb.delta !== undefined
            ? hb.delta
            : hb.buyVolume !== undefined && hb.sellVolume !== undefined
            ? hb.buyVolume - hb.sellVolume
            : ((hb.close - hb.open) / Math.max(0.001, hb.high - hb.low)) * (hb.volume * 0.4);
        runningCvd += delta;
        renderBars.push({
          delta,
          cvd: runningCvd,
          barIndex: i - history.length,
        });
      });
    }

    // Process live bars
    const historyCvdOffset = runningCvd;
    if (hasLiveBars) {
      bars.forEach((b, i) => {
        renderBars.push({
          delta: b.delta,
          cvd: b.cvd + historyCvdOffset,
          barIndex: i,
        });
      });
    }

    let maxDelta = -Infinity;
    let minDelta = Infinity;
    let maxCvd = -Infinity;
    let minCvd = Infinity;

    renderBars.forEach((b) => {
      if (b.delta > maxDelta) maxDelta = b.delta;
      if (b.delta < minDelta) minDelta = b.delta;
      if (b.cvd > maxCvd) maxCvd = b.cvd;
      if (b.cvd < minCvd) minCvd = b.cvd;
    });

    const deltaRange = Math.max(1, Math.max(Math.abs(maxDelta), Math.abs(minDelta)) * 2);
    const cvdRange = Math.max(1, maxCvd - minCvd);

    const zeroY = height / 2;
    const fallbackBarWidth = Math.max(4, Math.min(24, chartWidth / renderBars.length));
    const fallbackSpacing = 4;

    // Zero line
    ctx.strokeStyle = '#1C2630';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, zeroY);
    ctx.lineTo(chartWidth, zeroY);
    ctx.stroke();

    // 1. Draw Delta Histogram
    renderBars.forEach((b) => {
      const x = viewport
        ? viewport.panX + b.barIndex * (viewport.barWidth + viewport.barSpacing)
        : b.barIndex * (fallbackBarWidth + fallbackSpacing) + 10;
      const bWidth = viewport ? viewport.barWidth : fallbackBarWidth;

      if (x + bWidth < 0 || x > chartWidth) return;

      const barH = (b.delta / (deltaRange / 2)) * (height * 0.38);
      ctx.fillStyle = b.delta >= 0 ? '#19C37D' : '#F05252';

      if (b.delta >= 0) {
        ctx.fillRect(x + 1, zeroY - barH, Math.max(2, bWidth - 2), barH);
      } else {
        ctx.fillRect(x + 1, zeroY, Math.max(2, bWidth - 2), Math.abs(barH));
      }
    });

    // 2. Draw CVD Line (#A78BFA)
    ctx.strokeStyle = '#A78BFA';
    ctx.lineWidth = 2;
    ctx.beginPath();
    let first = true;
    renderBars.forEach((b) => {
      const x = viewport
        ? viewport.panX + b.barIndex * (viewport.barWidth + viewport.barSpacing) + viewport.barWidth / 2
        : b.barIndex * (fallbackBarWidth + fallbackSpacing) + 10 + fallbackBarWidth / 2;
      const y = height - 12 - ((b.cvd - minCvd) / cvdRange) * (height - 24);
      if (first) {
        ctx.moveTo(x, y);
        first = false;
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();

    // 2.1 Boundary line between history and live ticks
    if (hasHistoryBars && hasLiveBars && viewport) {
      ctx.save();
      ctx.strokeStyle = '#25303A';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(viewport.panX, 0);
      ctx.lineTo(viewport.panX, height);
      ctx.stroke();
      ctx.restore();
    }

    // 3. Synchronized Crosshair
    if (crosshairX !== null && crosshairX !== undefined && crosshairX >= 0 && crosshairX < chartWidth) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(crosshairX, 0);
      ctx.lineTo(crosshairX, height);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Labels & Gutter Values
    const displayedCvd = hasLiveBars ? (currentCVD + historyCvdOffset) : runningCvd;
    ctx.fillStyle = '#7F8B97';
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`CVD: ${displayedCvd >= 0 ? '+' : ''}${displayedCvd.toFixed(1)}`, 10, 14);

    ctx.textAlign = 'right';
    ctx.fillText(`+${maxCvd.toFixed(0)}`, width - 6, 14);
    ctx.fillText(`${minCvd.toFixed(0)}`, width - 6, height - 6);
  }, [bars, historyBars, currentCVD, viewport, crosshairX]);

  const isResizingRef = useRef(false);
  const resizeStartYRef = useRef(0);
  const resizeStartHeightRef = useRef(height);

  const handleResizeStart = (e: React.MouseEvent) => {
    isResizingRef.current = true;
    resizeStartYRef.current = e.clientY;
    resizeStartHeightRef.current = height;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (moveEv: MouseEvent) => {
      if (!isResizingRef.current) return;
      const deltaY = resizeStartYRef.current - moveEv.clientY;
      const newHeight = Math.max(55, Math.min(220, resizeStartHeightRef.current + deltaY));
      if (onHeightChange) {
        onHeightChange(newHeight);
      }
    };

    const onMouseUp = () => {
      isResizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  return (
    <div
      className="w-full border-t border-[#1C2630] bg-[#080B0F] relative select-none flex-shrink-0"
      style={{ height: `${height}px` }}
    >
      {/* Top Drag Resize Handle */}
      <div
        onMouseDown={handleResizeStart}
        className="absolute top-0 left-0 right-0 h-1.5 cursor-row-resize z-20 hover:bg-[#22D3EE]/40 transition-colors"
        title="Drag to resize CVD panel height"
      />
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-1.5 right-[82px] text-[#64748B] hover:text-[#E2E8F0] z-20 text-[10px] font-mono px-1 py-0.5 rounded hover:bg-[#1C2630]"
          title="Collapse CVD panel"
        >
          ✕
        </button>
      )}
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        className="w-full h-full block cursor-crosshair"
      />
    </div>
  );
};

import React, { useEffect, useRef } from 'react';
import { ChartViewport, FootprintBar } from '../../types';

interface CVDPanelProps {
  bars: FootprintBar[];
  currentCVD: number;
  viewport?: ChartViewport;
  crosshairX?: number | null;
  onViewportChange?: (vp: ChartViewport) => void;
  onCrosshairChange?: (x: number | null) => void;
}

export const CVDPanel: React.FC<CVDPanelProps> = ({
  bars,
  currentCVD,
  viewport,
  crosshairX,
  onViewportChange,
  onCrosshairChange,
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
      onCrosshairChange(curX < canvas.clientWidth - 65 ? curX : null);
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

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!viewport || !onViewportChange) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    onViewportChange({
      ...viewport,
      barWidth: Math.max(40, Math.min(180, viewport.barWidth * factor)),
    });
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cssWidth = canvas.parentElement?.clientWidth || 600;
    const cssHeight = canvas.parentElement?.clientHeight || 120;
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

    ctx.fillStyle = '#11141c';
    ctx.fillRect(0, 0, width, height);

    if (bars.length === 0) return;

    // Calculate Min & Max for scaling
    let maxDelta = -Infinity;
    let minDelta = Infinity;
    let maxCvd = -Infinity;
    let minCvd = Infinity;

    bars.forEach((b) => {
      if (b.delta > maxDelta) maxDelta = b.delta;
      if (b.delta < minDelta) minDelta = b.delta;
      if (b.cvd > maxCvd) maxCvd = b.cvd;
      if (b.cvd < minCvd) minCvd = b.cvd;
    });

    const deltaRange = Math.max(1, Math.max(Math.abs(maxDelta), Math.abs(minDelta)) * 2);
    const cvdRange = Math.max(1, maxCvd - minCvd);

    const zeroY = height / 2;
    const fallbackBarWidth = Math.max(4, Math.min(24, (width - 80) / bars.length));
    const fallbackSpacing = 4;

    // Draw zero line
    ctx.strokeStyle = '#232936';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, zeroY);
    ctx.lineTo(width - 65, zeroY);
    ctx.stroke();

    // 1. Draw Bar Delta Histogram
    bars.forEach((b, i) => {
      const x = viewport
        ? viewport.panX + i * (viewport.barWidth + viewport.barSpacing)
        : i * (fallbackBarWidth + fallbackSpacing) + 10;
      const bWidth = viewport ? viewport.barWidth : fallbackBarWidth;

      // Cull bars outside visible area
      if (x + bWidth < 0 || x > width - 65) return;

      const barH = (b.delta / (deltaRange / 2)) * (height * 0.4);
      ctx.fillStyle = b.delta >= 0 ? '#10b981' : '#ef4444';

      if (b.delta >= 0) {
        ctx.fillRect(x + 2, zeroY - barH, Math.max(2, bWidth - 4), barH);
      } else {
        ctx.fillRect(x + 2, zeroY, Math.max(2, bWidth - 4), Math.abs(barH));
      }
    });

    // 2. Draw CVD Line
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    let first = true;
    bars.forEach((b, i) => {
      const x = viewport
        ? viewport.panX + i * (viewport.barWidth + viewport.barSpacing) + viewport.barWidth / 2
        : i * (fallbackBarWidth + fallbackSpacing) + 10 + fallbackBarWidth / 2;
      const y = height - 15 - ((b.cvd - minCvd) / cvdRange) * (height - 30);
      if (first) {
        ctx.moveTo(x, y);
        first = false;
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();

    // 3. Draw Synchronized Crosshair
    if (crosshairX !== null && crosshairX !== undefined && crosshairX >= 0 && crosshairX < width - 65) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(crosshairX, 0);
      ctx.lineTo(crosshairX, height);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Labels
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.fillText(`CVD: ${currentCVD >= 0 ? '+' : ''}${currentCVD.toFixed(1)}`, 10, 14);
    ctx.fillText(`Max: +${maxCvd.toFixed(0)}`, width - 60, 14);
    ctx.fillText(`Min: ${minCvd.toFixed(0)}`, width - 60, height - 6);
  }, [bars, currentCVD, viewport, crosshairX]);

  return (
    <div className="w-full h-28 border-t border-brand-border bg-brand-surface relative select-none">
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
        className="w-full h-full block cursor-crosshair"
      />
    </div>
  );
};

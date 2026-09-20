import React, { useEffect, useRef } from 'react';
import { FootprintBar } from '../../types';

interface CVDPanelProps {
  bars: FootprintBar[];
  currentCVD: number;
}

export const CVDPanel: React.FC<CVDPanelProps> = ({ bars, currentCVD }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.parentElement?.clientWidth || 600;
    const height = canvas.parentElement?.clientHeight || 120;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

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
    const barWidth = Math.max(4, Math.min(24, (width - 80) / bars.length));
    const spacing = 4;

    // Draw zero line
    ctx.strokeStyle = '#232936';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, zeroY);
    ctx.lineTo(width - 65, zeroY);
    ctx.stroke();

    // 1. Draw Bar Delta Histogram
    bars.forEach((b, i) => {
      const x = i * (barWidth + spacing) + 10;
      const barH = (b.delta / (deltaRange / 2)) * (height * 0.4);
      ctx.fillStyle = b.delta >= 0 ? '#10b981' : '#ef4444';

      if (b.delta >= 0) {
        ctx.fillRect(x, zeroY - barH, barWidth, barH);
      } else {
        ctx.fillRect(x, zeroY, barWidth, Math.abs(barH));
      }
    });

    // 2. Draw CVD Line
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    bars.forEach((b, i) => {
      const x = i * (barWidth + spacing) + 10 + barWidth / 2;
      const y = height - 15 - ((b.cvd - minCvd) / cvdRange) * (height - 30);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Labels
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.fillText(`CVD: ${currentCVD >= 0 ? '+' : ''}${currentCVD.toFixed(1)}`, 10, 14);
    ctx.fillText(`Max: +${maxCvd.toFixed(0)}`, width - 60, 14);
    ctx.fillText(`Min: ${minCvd.toFixed(0)}`, width - 60, height - 6);
  }, [bars, currentCVD]);

  return (
    <div className="w-full h-28 border-t border-brand-border bg-brand-surface relative select-none">
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import { Compass, Crosshair, Eye, Maximize2, Radio, Zap } from 'lucide-react';
import { DeepTrade, OrderbookSnapshot, Tick } from '../../types';

interface OrderFlowRadarProps {
  symbol: string;
  currentPrice: number;
  orderbook: OrderbookSnapshot;
  deepTrades: DeepTrade[];
  recentTicks: Tick[];
  soundEnabled?: boolean;
}

export const OrderFlowRadar: React.FC<OrderFlowRadarProps> = ({
  symbol,
  currentPrice,
  orderbook,
  deepTrades,
  recentTicks,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [rangePercent, setRangePercent] = useState<number>(0.5); // ±0.5% default
  const [sweepSpeed, setSweepSpeed] = useState<number>(1.2); // deg per frame
  const [hoveredTarget, setHoveredTarget] = useState<string | null>(null);

  // Audio synthesis helper for whale pings
  const lastWhaleRef = useRef<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let angle = 0;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2;
      const centerY = height / 2;
      const maxRadius = Math.min(centerX, centerY) - 16;

      // Clear with dark cyber fade for motion trails
      ctx.fillStyle = 'rgba(6, 9, 14, 0.28)';
      ctx.fillRect(0, 0, width, height);

      // Draw concentric polar radar grid rings
      const rings = [0.25, 0.5, 0.75, 1.0];
      rings.forEach((pct, idx) => {
        const r = maxRadius * pct;
        ctx.beginPath();
        ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
        ctx.strokeStyle = idx === rings.length - 1 ? 'rgba(0, 242, 254, 0.35)' : 'rgba(0, 242, 254, 0.12)';
        ctx.lineWidth = idx === rings.length - 1 ? 1.5 : 1;
        ctx.stroke();

        // Ring label
        ctx.fillStyle = 'rgba(0, 242, 254, 0.45)';
        ctx.font = '9px monospace';
        const distLabel = `±${(rangePercent * pct).toFixed(2)}%`;
        ctx.fillText(distLabel, centerX + 4, centerY - r + 10);
      });

      // Crosshairs & diagonal radial lines
      ctx.strokeStyle = 'rgba(0, 242, 254, 0.15)';
      ctx.lineWidth = 1;

      // Horizontal
      ctx.beginPath();
      ctx.moveTo(centerX - maxRadius, centerY);
      ctx.lineTo(centerX + maxRadius, centerY);
      ctx.stroke();

      // Vertical
      ctx.beginPath();
      ctx.moveTo(centerX, centerY - maxRadius);
      ctx.lineTo(centerX, centerY + maxRadius);
      ctx.stroke();

      // 45-degree diagonals
      for (let d = 1; d <= 3; d += 2) {
        const rad = (d * Math.PI) / 4;
        ctx.beginPath();
        ctx.moveTo(centerX - Math.cos(rad) * maxRadius, centerY - Math.sin(rad) * maxRadius);
        ctx.lineTo(centerX + Math.cos(rad) * maxRadius, centerY + Math.sin(rad) * maxRadius);
        ctx.stroke();
      }

      // Compass Cardinal Labels (N, E, S, W)
      ctx.fillStyle = '#00f2fe';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('N (+ASK)', centerX, centerY - maxRadius - 8);
      ctx.fillText('S (-BID)', centerX, centerY + maxRadius + 8);
      ctx.fillText('E (VOL+)', centerX + maxRadius + 8, centerY);
      ctx.fillText('W (ABS-)', centerX - maxRadius - 8, centerY);

      // Draw Rotating Radar Beam Sweep with gradient fan
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      const sweepRad = (angle * Math.PI) / 180;
      const trailAngle = sweepRad - 0.55; // ~30 degree beam
      ctx.arc(centerX, centerY, maxRadius, trailAngle, sweepRad, false);
      ctx.closePath();

      const beamGrad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, maxRadius);
      beamGrad.addColorStop(0, 'rgba(0, 242, 254, 0.35)');
      beamGrad.addColorStop(0.7, 'rgba(0, 242, 254, 0.12)');
      beamGrad.addColorStop(1, 'rgba(0, 242, 254, 0.0)');
      ctx.fillStyle = beamGrad;
      ctx.fill();

      // Leading beam edge line
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(centerX + Math.cos(sweepRad) * maxRadius, centerY + Math.sin(sweepRad) * maxRadius);
      ctx.strokeStyle = '#00f2fe';
      ctx.lineWidth = 1.5;
      ctx.shadowColor = '#00f2fe';
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.restore();

      // Draw resting liquidity blips from Orderbook
      const maxDistPrice = (currentPrice * (rangePercent / 100)) || 10;
      
      // Asks (Upper Arc: angle 180° to 360°)
      if (orderbook.asks && orderbook.asks.length > 0) {
        orderbook.asks.slice(0, 16).forEach((level, i) => {
          const deltaPrice = Math.abs(level.price - currentPrice);
          const distNorm = Math.min(1, deltaPrice / maxDistPrice);
          const r = distNorm * maxRadius;
          // Distribute across upper arc 200° to 340°
          const theta = ((210 + i * 8) * Math.PI) / 180;
          const x = centerX + Math.cos(theta) * r;
          const y = centerY + Math.sin(theta) * r;

          const sizeRadius = Math.max(2.5, Math.min(7, Math.sqrt(level.size) * 0.8));
          ctx.beginPath();
          ctx.arc(x, y, sizeRadius, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(244, 63, 94, 0.85)';
          ctx.shadowColor = '#f43f5e';
          ctx.shadowBlur = 6;
          ctx.fill();
        });
      }

      // Bids (Lower Arc: angle 20° to 160°)
      if (orderbook.bids && orderbook.bids.length > 0) {
        orderbook.bids.slice(0, 16).forEach((level, i) => {
          const deltaPrice = Math.abs(currentPrice - level.price);
          const distNorm = Math.min(1, deltaPrice / maxDistPrice);
          const r = distNorm * maxRadius;
          // Distribute across lower arc 30° to 150°
          const theta = ((30 + i * 8) * Math.PI) / 180;
          const x = centerX + Math.cos(theta) * r;
          const y = centerY + Math.sin(theta) * r;

          const sizeRadius = Math.max(2.5, Math.min(7, Math.sqrt(level.size) * 0.8));
          ctx.beginPath();
          ctx.arc(x, y, sizeRadius, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(16, 185, 129, 0.85)';
          ctx.shadowColor = '#10b981';
          ctx.shadowBlur = 6;
          ctx.fill();
        });
      }

      // Draw Institutional Whale DeepTrades (glowing pulsing circles)
      if (deepTrades && deepTrades.length > 0) {
        deepTrades.slice(0, 5).forEach((whale, idx) => {
          const diff = Math.abs(whale.price - currentPrice);
          const distNorm = Math.min(0.9, diff / maxDistPrice);
          const r = distNorm * maxRadius;
          const theta = ((idx * 72 + (whale.side === 'buy' ? 45 : 225)) * Math.PI) / 180;
          const x = centerX + Math.cos(theta) * r;
          const y = centerY + Math.sin(theta) * r;

          // Pulsing halo
          const pulse = (Date.now() / 200) % 8;
          ctx.beginPath();
          ctx.arc(x, y, 9 + pulse, 0, Math.PI * 2);
          ctx.strokeStyle = whale.side === 'buy' ? 'rgba(0, 242, 254, 0.7)' : 'rgba(245, 158, 11, 0.7)';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          // Core dot
          ctx.beginPath();
          ctx.arc(x, y, 4.5, 0, Math.PI * 2);
          ctx.fillStyle = whale.side === 'buy' ? '#00f2fe' : '#f59e0b';
          ctx.shadowColor = '#00f2fe';
          ctx.shadowBlur = 12;
          ctx.fill();

          // Whale label
          ctx.fillStyle = '#E7EDF3';
          ctx.font = '8px monospace';
          ctx.fillText(`$${(whale.valueUsd / 1000).toFixed(0)}k`, x + 12, y - 4);
        });
      }

      // Center Core: Current Price Hologram
      ctx.beginPath();
      ctx.arc(centerX, centerY, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#00f2fe';
      ctx.shadowColor = '#00f2fe';
      ctx.shadowBlur = 10;
      ctx.fill();

      // Step sweep angle
      angle = (angle + sweepSpeed) % 360;
      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [currentPrice, orderbook, deepTrades, rangePercent, sweepSpeed]);

  return (
    <div className="cyber-panel cyber-corner-brackets p-3 flex flex-col h-full select-none">
      {/* Panel Header */}
      <div className="flex items-center justify-between border-b border-[#00f2fe]/20 pb-2 mb-2">
        <div className="flex items-center gap-2">
          <Radio size={14} className="text-[#00f2fe] animate-pulse" />
          <span className="font-mono text-xs font-bold text-[#E7EDF3] tracking-wider uppercase">
            Order Flow Polar Radar
          </span>
          <span className="cyber-badge px-1.5 py-0.5 rounded">360° SWEEP</span>
        </div>

        {/* Range Selector Controls */}
        <div className="flex items-center gap-1 font-mono text-[10px]">
          <span className="text-[#7F8B97] mr-1">RANGE:</span>
          {[0.25, 0.5, 1.0].map((rng) => (
            <button
              key={rng}
              onClick={() => setRangePercent(rng)}
              className={`px-1.5 py-0.5 rounded border transition-all ${
                rangePercent === rng
                  ? 'bg-[#00f2fe]/20 border-[#00f2fe] text-[#00f2fe] font-bold shadow-[0_0_8px_rgba(0,242,254,0.4)]'
                  : 'bg-[#0B1017] border-[#1C2630] text-[#7F8B97] hover:text-[#E7EDF3]'
              }`}
            >
              ±{rng}%
            </button>
          ))}
        </div>
      </div>

      {/* Main Canvas Container */}
      <div className="flex-1 relative flex items-center justify-center min-h-[260px] overflow-hidden">
        <canvas
          ref={canvasRef}
          width={360}
          height={320}
          className="w-full h-full max-w-[360px] max-h-[320px] rounded object-contain"
        />

        {/* Cyber telemetry HUD overlay data */}
        <div className="absolute top-2 left-2 font-mono text-[10px] text-[#7F8B97] bg-[#06090e]/85 backdrop-blur-sm px-2 py-1 rounded border border-[#1C2630]/60 space-y-0.5">
          <div className="text-[#00f2fe] font-bold">RADAR ACTIVE</div>
          <div>SWEEP: {sweepSpeed * 60}°/s</div>
          <div>CENTRAL: {currentPrice.toFixed(2)}</div>
        </div>

        {/* Legend */}
        <div className="absolute bottom-2 right-2 font-mono text-[9px] text-[#7F8B97] bg-[#06090e]/85 backdrop-blur-sm px-2 py-1 rounded border border-[#1C2630]/60 flex items-center gap-2.5">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] shadow-[0_0_6px_#10b981]" />
            <span>BIDS</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#f43f5e] shadow-[0_0_6px_#f43f5e]" />
            <span>ASKS</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00f2fe] shadow-[0_0_6px_#00f2fe]" />
            <span>WHALES</span>
          </span>
        </div>
      </div>
    </div>
  );
};

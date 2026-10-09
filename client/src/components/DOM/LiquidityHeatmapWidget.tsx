import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Database,
  FastForward,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { deepchartApi } from '../../services/api';
import { DepthHeatmapSnapshot } from '../../types';

interface LiquidityHeatmapWidgetProps {
  symbol: string;
  currentPrice: number;
  tickSize?: number;
}

type ReplaySpeed = 1 | 2 | 5 | 10;
type TimeRangePreset = '15m' | '1h' | '4h' | 'all';

export const LiquidityHeatmapWidget: React.FC<LiquidityHeatmapWidgetProps> = ({
  symbol,
  currentPrice,
  tickSize = 0.25,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Data state
  const [snapshots, setSnapshots] = useState<DepthHeatmapSnapshot[]>([]);
  const [dataSource, setDataSource] = useState<string>('none');
  const [totalAvailable, setTotalAvailable] = useState<number>(0);
  const [samplingIntervalMs, setSamplingIntervalMs] = useState<number>(250);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Mode: LIVE streaming vs HISTORICAL REPLAY
  const [isReplayMode, setIsReplayMode] = useState<boolean>(false);
  const [rangePreset, setRangePreset] = useState<TimeRangePreset>('1h');

  // Replay playback controls
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [replaySpeed, setReplaySpeed] = useState<ReplaySpeed>(1);
  const [playheadIndex, setPlayheadIndex] = useState<number>(0);
  const playheadRef = useRef<number>(0);
  playheadRef.current = playheadIndex;

  // Settings
  const [intensityMultiplier, setIntensityMultiplier] = useState<number>(1);
  const [wallThresholdMultiplier, setWallThresholdMultiplier] = useState<number>(3); // 3x average size is a wall
  const [showWalls, setShowWalls] = useState<boolean>(true);

  // Viewport / Zoom / Pan
  const [zoomX, setZoomX] = useState<number>(1);
  const [panX, setPanX] = useState<number>(0);
  const [hoveredPoint, setHoveredPoint] = useState<{
    x: number;
    y: number;
    price: number;
    time: number;
    bidSize?: number;
    askSize?: number;
    isWall?: boolean;
  } | null>(null);

  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, panX: 0 });

  // Fetch Heatmap Data (from SQLite historical storage / vendor / live fallback)
  const fetchHeatmapData = useCallback(async (customFrom?: number, customTo?: number) => {
    setLoading(true);
    setError(null);
    try {
      let from = customFrom;
      let to = customTo;

      if (!from && !to) {
        const now = Date.now();
        if (rangePreset === '15m') from = now - 15 * 60 * 1000;
        else if (rangePreset === '1h') from = now - 60 * 60 * 1000;
        else if (rangePreset === '4h') from = now - 4 * 60 * 60 * 1000;
        else from = now - 24 * 60 * 60 * 1000;
        to = now;
      }

      const resp = await deepchartApi.getDepthHeatmap(symbol, from, to, 250, 1000);
      const rawSnaps = resp.snapshots || [];

      // Normalize timestamps (server provides time or timestamp)
      const normalized = rawSnaps.map((s) => ({
        ...s,
        time: s.time ?? s.timestamp ?? 0,
        timestamp: s.time ?? s.timestamp ?? 0,
      }));

      setSnapshots(normalized);
      setDataSource(resp.dataSource || (normalized.length > 0 ? 'sqlite_mbp10' : 'none'));
      setTotalAvailable(resp.totalAvailable ?? normalized.length);
      setSamplingIntervalMs(resp.samplingIntervalMs ?? 250);

      // Reset playhead in replay mode if out of bounds
      if (normalized.length > 0) {
        setPlayheadIndex((prev) => Math.min(prev, normalized.length - 1));
      } else {
        setPlayheadIndex(0);
      }
    } catch (err: any) {
      setError(err?.message || 'Không thể tải historical depth');
      setSnapshots([]);
      setDataSource('none');
    } finally {
      setLoading(false);
    }
  }, [symbol, rangePreset]);

  // Initial load and range change
  useEffect(() => {
    fetchHeatmapData();
  }, [fetchHeatmapData]);

  // In LIVE mode: auto-refresh latest depth snapshots every 4 seconds
  useEffect(() => {
    if (isReplayMode) return;
    const interval = setInterval(() => {
      fetchHeatmapData();
    }, 4000);
    return () => clearInterval(interval);
  }, [isReplayMode, fetchHeatmapData]);

  // Replay playback loop
  useEffect(() => {
    if (!isReplayMode || !isPlaying || snapshots.length === 0) return;

    // Calculate advance step interval based on replaySpeed
    const stepIntervalMs = Math.max(20, Math.floor(samplingIntervalMs / replaySpeed));

    const timer = setInterval(() => {
      setPlayheadIndex((prev) => {
        if (prev >= snapshots.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, stepIntervalMs);

    return () => clearInterval(timer);
  }, [isReplayMode, isPlaying, snapshots.length, replaySpeed, samplingIntervalMs]);

  // Compute price bounds & max depth across snapshots
  const { minPrice, maxPrice, maxDepthSize, avgDepthSize } = useMemo(() => {
    if (!snapshots || snapshots.length === 0) {
      const base = currentPrice > 0 ? currentPrice : 5000;
      return { minPrice: base - 10, maxPrice: base + 10, maxDepthSize: 100, avgDepthSize: 20 };
    }

    let min = Infinity;
    let max = -Infinity;
    let maxDepth = 1;
    let totalDepth = 0;
    let depthCount = 0;

    const visibleSnaps = isReplayMode
      ? snapshots.slice(0, Math.max(1, playheadIndex + 1))
      : snapshots;

    for (const snap of visibleSnaps) {
      for (const b of snap.bids) {
        if (b.price < min) min = b.price;
        if (b.price > max) max = b.price;
        if (b.size > maxDepth) maxDepth = b.size;
        totalDepth += b.size;
        depthCount++;
      }
      for (const a of snap.asks) {
        if (a.price < min) min = a.price;
        if (a.price > max) max = a.price;
        if (a.size > maxDepth) maxDepth = a.size;
        totalDepth += a.size;
        depthCount++;
      }
    }

    if (currentPrice > 0) {
      if (currentPrice < min) min = currentPrice - tickSize * 10;
      if (currentPrice > max) max = currentPrice + tickSize * 10;
    }

    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      min = 4900;
      max = 5100;
    }

    const avg = depthCount > 0 ? totalDepth / depthCount : 20;
    return {
      minPrice: min,
      maxPrice: max,
      maxDepthSize: maxDepth,
      avgDepthSize: avg,
    };
  }, [snapshots, currentPrice, tickSize, isReplayMode, playheadIndex]);

  // Render Canvas with Viewport Culling & Gap Detection
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    if (width === 0 || height === 0) return;

    ctx.clearRect(0, 0, width, height);

    // Dark terminal background
    ctx.fillStyle = '#080B0E';
    ctx.fillRect(0, 0, width, height);

    if (snapshots.length === 0) {
      return;
    }

    const rightMargin = 60;
    const bottomMargin = 24;
    const plotWidth = width - rightMargin;
    const plotHeight = height - bottomMargin;

    const priceRange = maxPrice - minPrice || 1;
    const priceToY = (p: number) => {
      return plotHeight - ((p - minPrice) / priceRange) * plotHeight;
    };

    const colWidth = Math.max(3, (plotWidth / Math.max(1, snapshots.length)) * zoomX);
    const wallThreshold = avgDepthSize * wallThresholdMultiplier;

    // Draw Price Grid & Labels
    const numPriceLines = 8;
    ctx.strokeStyle = '#151D24';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#64748B';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';

    for (let i = 0; i <= numPriceLines; i++) {
      const p = minPrice + (priceRange / numPriceLines) * i;
      const y = priceToY(p);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(plotWidth, y);
      ctx.stroke();

      ctx.fillText(p.toFixed(2), plotWidth + 6, y + 3);
    }

    // Viewport Culling: calculate visible index range
    const firstVisibleIdx = Math.max(0, Math.floor((-panX) / colWidth) - 1);
    const lastVisibleIdx = Math.min(
      snapshots.length - 1,
      Math.ceil((plotWidth - panX) / colWidth) + 1
    );

    // Limit snapshots up to playhead in replay mode
    const maxRenderIdx = isReplayMode ? Math.min(lastVisibleIdx, playheadIndex) : lastVisibleIdx;

    for (let idx = firstVisibleIdx; idx <= maxRenderIdx; idx++) {
      const snap = snapshots[idx];
      const snapX = idx * colWidth + panX;
      if (snapX + colWidth < 0 || snapX > plotWidth) continue;

      const cellW = Math.max(2, colWidth);
      const cellH = Math.max(2, (tickSize / priceRange) * plotHeight);

      // Gap Detection: if difference between consecutive snapshots > 5000ms
      if (idx > 0) {
        const prevTime = snapshots[idx - 1].time ?? snapshots[idx - 1].timestamp ?? 0;
        const curTime = snap.time ?? snap.timestamp ?? 0;
        if (curTime - prevTime > 5000) {
          // Draw Gap warning stripe
          ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
          ctx.fillRect(snapX - 2, 0, 4, plotHeight);
          ctx.strokeStyle = '#EF4444';
          ctx.setLineDash([2, 2]);
          ctx.beginPath();
          ctx.moveTo(snapX, 0);
          ctx.lineTo(snapX, plotHeight);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Render Bids (Cyan/Blue gradient)
      for (const b of snap.bids) {
        if (b.price < minPrice || b.price > maxPrice) continue;
        const y = priceToY(b.price) - cellH / 2;
        const normalized = Math.min(1, (b.size / (maxDepthSize || 1)) * intensityMultiplier);
        const isWall = showWalls && b.size >= wallThreshold;

        if (isWall) {
          ctx.fillStyle = `rgba(34, 211, 238, ${Math.min(0.95, 0.45 + normalized * 0.55)})`;
          ctx.fillRect(snapX, y, cellW, cellH);
          ctx.strokeStyle = '#38BDF8';
          ctx.lineWidth = 1;
          ctx.strokeRect(snapX, y, cellW, cellH);
        } else {
          ctx.fillStyle = `rgba(14, 116, 144, ${Math.min(0.85, 0.15 + normalized * 0.7)})`;
          ctx.fillRect(snapX, y, cellW, cellH);
        }
      }

      // Render Asks (Amber/Rose gradient)
      for (const a of snap.asks) {
        if (a.price < minPrice || a.price > maxPrice) continue;
        const y = priceToY(a.price) - cellH / 2;
        const normalized = Math.min(1, (a.size / (maxDepthSize || 1)) * intensityMultiplier);
        const isWall = showWalls && a.size >= wallThreshold;

        if (isWall) {
          ctx.fillStyle = `rgba(244, 63, 94, ${Math.min(0.95, 0.45 + normalized * 0.55)})`;
          ctx.fillRect(snapX, y, cellW, cellH);
          ctx.strokeStyle = '#FB7185';
          ctx.lineWidth = 1;
          ctx.strokeRect(snapX, y, cellW, cellH);
        } else {
          ctx.fillStyle = `rgba(194, 65, 12, ${Math.min(0.85, 0.15 + normalized * 0.7)})`;
          ctx.fillRect(snapX, y, cellW, cellH);
        }
      }
    }

    // In REPLAY mode, draw playhead line
    if (isReplayMode && snapshots.length > 0) {
      const playheadX = playheadIndex * colWidth + panX;
      if (playheadX >= 0 && playheadX <= plotWidth) {
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(playheadX, 0);
        ctx.lineTo(playheadX, plotHeight);
        ctx.stroke();

        // Playhead triangle marker on top
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.moveTo(playheadX - 4, 0);
        ctx.lineTo(playheadX + 4, 0);
        ctx.lineTo(playheadX, 6);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Draw Current Price Line
    if (currentPrice >= minPrice && currentPrice <= maxPrice) {
      const curY = priceToY(currentPrice);
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = '#FACC15';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, curY);
      ctx.lineTo(plotWidth, curY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Current Price Badge
      ctx.fillStyle = '#FACC15';
      ctx.fillRect(plotWidth + 1, curY - 8, rightMargin - 2, 16);
      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 10px monospace';
      ctx.fillText(currentPrice.toFixed(2), plotWidth + 4, curY + 4);
    }

    // Time Axis Labels
    ctx.fillStyle = '#64748B';
    ctx.font = '9px monospace';
    const numTimeLabels = Math.min(6, snapshots.length);
    if (numTimeLabels > 1) {
      const step = Math.floor(snapshots.length / numTimeLabels);
      for (let i = 0; i < snapshots.length; i += step) {
        const snap = snapshots[i];
        const snapX = i * colWidth + panX;
        if (snapX >= 0 && snapX <= plotWidth - 40) {
          const snapTime = snap.time ?? snap.timestamp ?? 0;
          const d = new Date(snapTime);
          const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
          ctx.fillText(timeStr, snapX, height - 6);
        }
      }
    }

    // Hover Crosshair & Tooltip
    if (hoveredPoint && hoveredPoint.x <= plotWidth) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);

      // Vertical line
      ctx.beginPath();
      ctx.moveTo(hoveredPoint.x, 0);
      ctx.lineTo(hoveredPoint.x, plotHeight);
      ctx.stroke();

      // Horizontal line
      ctx.beginPath();
      ctx.moveTo(0, hoveredPoint.y);
      ctx.lineTo(plotWidth, hoveredPoint.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [
    snapshots,
    minPrice,
    maxPrice,
    maxDepthSize,
    avgDepthSize,
    zoomX,
    panX,
    intensityMultiplier,
    showWalls,
    wallThresholdMultiplier,
    currentPrice,
    tickSize,
    hoveredPoint,
    isReplayMode,
    playheadIndex,
  ]);

  // Resize canvas according to container dimensions
  useEffect(() => {
    const handleResize = () => {
      if (!containerRef.current || !canvasRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvasRef.current.width = rect.width * dpr;
      canvasRef.current.height = rect.height * dpr;
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) ctx.scale(dpr, dpr);
    };

    handleResize();
    const ro = new ResizeObserver(handleResize);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Mouse interaction handlers (Pan & Hover)
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX, panX };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || snapshots.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (isDraggingRef.current) {
      const dx = e.clientX - dragStartRef.current.x;
      setPanX(dragStartRef.current.panX + dx);
      return;
    }

    const rightMargin = 60;
    const bottomMargin = 24;
    const plotWidth = rect.width - rightMargin;
    const plotHeight = rect.height - bottomMargin;

    if (mouseX < 0 || mouseX > plotWidth || mouseY < 0 || mouseY > plotHeight) {
      setHoveredPoint(null);
      return;
    }

    const priceRange = maxPrice - minPrice || 1;
    const hoveredPrice = minPrice + ((plotHeight - mouseY) / plotHeight) * priceRange;
    const normPrice = Math.round(hoveredPrice / tickSize) * tickSize;

    const colWidth = Math.max(3, (plotWidth / Math.max(1, snapshots.length)) * zoomX);
    const snapIdx = Math.max(0, Math.min(snapshots.length - 1, Math.floor((mouseX - panX) / colWidth)));
    const snap = snapshots[snapIdx];

    if (!snap) {
      setHoveredPoint(null);
      return;
    }

    const bid = snap.bids.find((b) => Math.abs(b.price - normPrice) < tickSize / 2);
    const ask = snap.asks.find((a) => Math.abs(a.price - normPrice) < tickSize / 2);
    const wallThresh = avgDepthSize * wallThresholdMultiplier;
    const isWall = (bid?.size ?? 0) >= wallThresh || (ask?.size ?? 0) >= wallThresh;

    setHoveredPoint({
      x: mouseX,
      y: mouseY,
      price: normPrice,
      time: snap.time ?? snap.timestamp ?? 0,
      bidSize: bid?.size,
      askSize: ask?.size,
      isWall,
    });
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
    setZoomX((prev) => Math.max(0.2, Math.min(15, prev * zoomFactor)));
  };

  // Replay Step handlers
  const handleStepBackward = () => {
    setIsPlaying(false);
    setPlayheadIndex((prev) => Math.max(0, prev - 1));
  };

  const handleStepForward = () => {
    setIsPlaying(false);
    setPlayheadIndex((prev) => Math.min(snapshots.length - 1, prev + 1));
  };

  const currentReplayTime = useMemo(() => {
    if (snapshots.length === 0 || playheadIndex >= snapshots.length) return null;
    const snap = snapshots[playheadIndex];
    const ts = snap.time ?? snap.timestamp ?? 0;
    return new Date(ts).toLocaleTimeString();
  }, [snapshots, playheadIndex]);

  return (
    <div className="flex flex-col h-full bg-[#080B0E] select-none text-[#94A3B8]">
      {/* Top Controls Toolbar */}
      <div className="flex flex-wrap items-center justify-between px-3 py-1.5 border-b border-[#1C2630] bg-[#0E1318] text-xs gap-2">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-[#38BDF8]" />
          <span className="font-semibold tracking-wide text-[#E2E8F0]">MBP-10 Heatmap</span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#1E293B] text-[#94A3B8]">
            {symbol} ({snapshots.length} frames)
          </span>

          {/* Data Source Badge */}
          <span
            className={`flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border ${
              dataSource === 'sqlite_mbp10'
                ? 'bg-[#0E7490]/20 text-[#38BDF8] border-[#0891B2]/40'
                : dataSource === 'databento'
                ? 'bg-[#10B981]/20 text-[#34D399] border-[#059669]/40'
                : 'bg-[#1E293B] text-[#94A3B8] border-[#334155]'
            }`}
          >
            <Database size={10} />
            <span>{dataSource === 'sqlite_mbp10' ? 'SQLite MBP-10' : dataSource}</span>
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Mode Switcher: LIVE vs REPLAY */}
          <div className="flex items-center rounded bg-[#161F28] p-0.5 border border-[#1C2630]">
            <button
              onClick={() => {
                setIsReplayMode(false);
                setIsPlaying(false);
                fetchHeatmapData();
              }}
              className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors ${
                !isReplayMode
                  ? 'bg-[#0284C7] text-white'
                  : 'text-[#94A3B8] hover:text-[#E2E8F0]'
              }`}
            >
              LIVE
            </button>
            <button
              onClick={() => {
                setIsReplayMode(true);
                setIsPlaying(false);
                setPlayheadIndex(snapshots.length > 0 ? snapshots.length - 1 : 0);
              }}
              className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors ${
                isReplayMode
                  ? 'bg-[#F59E0B] text-black font-semibold'
                  : 'text-[#94A3B8] hover:text-[#E2E8F0]'
              }`}
            >
              REPLAY
            </button>
          </div>

          {/* Time Range Selector */}
          <div className="flex items-center rounded bg-[#161F28] p-0.5 border border-[#1C2630] text-[10px]">
            {(['15m', '1h', '4h', 'all'] as TimeRangePreset[]).map((preset) => (
              <button
                key={preset}
                onClick={() => setRangePreset(preset)}
                className={`px-1.5 py-0.5 rounded transition-colors ${
                  rangePreset === preset
                    ? 'bg-[#334155] text-white font-medium'
                    : 'text-[#94A3B8] hover:text-[#E2E8F0]'
                }`}
              >
                {preset.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Wall Highlight Toggle */}
          <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-[#94A3B8]">
            <input
              type="checkbox"
              checked={showWalls}
              onChange={(e) => setShowWalls(e.target.checked)}
              className="rounded bg-[#1E293B] border-[#334155] text-[#38BDF8] focus:ring-0"
            />
            <span>Walls ({wallThresholdMultiplier}x)</span>
          </label>

          {/* Intensity Multiplier */}
          <div className="flex items-center gap-1 text-[11px] text-[#94A3B8]">
            <span>Glow:</span>
            <select
              value={intensityMultiplier}
              onChange={(e) => setIntensityMultiplier(Number(e.target.value))}
              className="bg-[#1C2630] border border-[#334155] rounded px-1.5 py-0.5 text-xs text-[#E2E8F0]"
            >
              <option value={0.5}>0.5x</option>
              <option value={1}>1.0x</option>
              <option value={1.5}>1.5x</option>
              <option value={2}>2.0x</option>
              <option value={3}>3.0x</option>
            </select>
          </div>

          {/* Zoom Buttons */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setZoomX((prev) => Math.min(10, prev * 1.25))}
              className="p-1 rounded hover:bg-[#1C2630] text-[#94A3B8] hover:text-[#E2E8F0]"
              title="Zoom In"
            >
              <ZoomIn size={14} />
            </button>
            <button
              onClick={() => setZoomX((prev) => Math.max(0.5, prev * 0.8))}
              className="p-1 rounded hover:bg-[#1C2630] text-[#94A3B8] hover:text-[#E2E8F0]"
              title="Zoom Out"
            >
              <ZoomOut size={14} />
            </button>
            <button
              onClick={() => {
                setZoomX(1);
                setPanX(0);
              }}
              className="px-1.5 py-0.5 rounded text-[10px] font-mono hover:bg-[#1C2630] text-[#94A3B8]"
              title="Reset View"
            >
              Reset
            </button>
          </div>

          {/* Refresh */}
          <button
            onClick={() => fetchHeatmapData()}
            disabled={loading}
            className="p-1 rounded hover:bg-[#1C2630] text-[#94A3B8] hover:text-[#E2E8F0] disabled:opacity-50"
            title="Refresh Depth Snapshots"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* REPLAY Transport Bar (Visible when isReplayMode is active) */}
      {isReplayMode && (
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#1C2630] bg-[#0A0E13] text-xs">
          <div className="flex items-center gap-2">
            {/* Play/Pause */}
            <button
              onClick={() => setIsPlaying((prev) => !prev)}
              className={`p-1.5 rounded flex items-center justify-center transition-colors ${
                isPlaying
                  ? 'bg-[#EF4444] text-white hover:bg-[#DC2626]'
                  : 'bg-[#10B981] text-white hover:bg-[#059669]'
              }`}
              title={isPlaying ? 'Pause Replay' : 'Play Replay'}
            >
              {isPlaying ? <Pause size={14} /> : <Play size={14} />}
            </button>

            {/* Step Backward / Forward */}
            <button
              onClick={handleStepBackward}
              disabled={playheadIndex <= 0}
              className="p-1 rounded hover:bg-[#1C2630] text-[#94A3B8] hover:text-[#E2E8F0] disabled:opacity-40"
              title="Step Backward (1 snapshot)"
            >
              <ChevronLeft size={15} />
            </button>
            <button
              onClick={handleStepForward}
              disabled={playheadIndex >= snapshots.length - 1}
              className="p-1 rounded hover:bg-[#1C2630] text-[#94A3B8] hover:text-[#E2E8F0] disabled:opacity-40"
              title="Step Forward (1 snapshot)"
            >
              <ChevronRight size={15} />
            </button>

            {/* Reset Playhead */}
            <button
              onClick={() => {
                setIsPlaying(false);
                setPlayheadIndex(0);
              }}
              className="p-1 rounded hover:bg-[#1C2630] text-[#94A3B8] hover:text-[#E2E8F0]"
              title="Restart from beginning"
            >
              <RotateCcw size={13} />
            </button>

            {/* Speed Multiplier */}
            <div className="flex items-center gap-1 ml-2 text-[11px] font-mono">
              <FastForward size={12} className="text-[#F59E0B]" />
              <select
                value={replaySpeed}
                onChange={(e) => setReplaySpeed(Number(e.target.value) as ReplaySpeed)}
                className="bg-[#1C2630] border border-[#334155] rounded px-1.5 py-0.5 text-xs text-[#E2E8F0]"
              >
                <option value={1}>1x</option>
                <option value={2}>2x</option>
                <option value={5}>5x</option>
                <option value={10}>10x</option>
              </select>
            </div>
          </div>

          {/* Timeline Scrubber */}
          <div className="flex items-center gap-3 flex-1 max-w-xl mx-4">
            <span className="text-[10px] font-mono text-[#64748B] min-w-[50px]">
              {playheadIndex + 1}/{snapshots.length}
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(0, snapshots.length - 1)}
              value={playheadIndex}
              onChange={(e) => {
                setIsPlaying(false);
                setPlayheadIndex(Number(e.target.value));
              }}
              className="w-full h-1 bg-[#1E293B] rounded-lg appearance-none cursor-pointer accent-[#38BDF8]"
            />
            <span className="text-[10px] font-mono text-[#E2E8F0] min-w-[70px] text-right">
              {currentReplayTime || '--:--:--'}
            </span>
          </div>

          <div className="text-[10px] font-mono text-[#94A3B8]">
            Sampling: {samplingIntervalMs}ms
          </div>
        </div>
      )}

      {/* Main Canvas Area */}
      <div
        ref={containerRef}
        className="flex-1 relative min-h-0 overflow-hidden cursor-crosshair"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          isDraggingRef.current = false;
          setHoveredPoint(null);
        }}
        onWheel={handleWheel}
      >
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />

        {/* Empty / Fail-closed State */}
        {!loading && snapshots.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-[#080B0E]/90 backdrop-blur-sm">
            <AlertCircle size={32} className="text-[#F59E0B] mb-2" />
            <h4 className="text-sm font-semibold text-[#E2E8F0]">Chưa có dữ liệu Historical Depth (MBP-10)</h4>
            <p className="text-xs text-[#94A3B8] max-w-sm mt-1 leading-relaxed">
              Hệ thống hoạt động theo chuẩn <strong>Fail-Closed</strong> và không tự tạo snapshot lịch sử depth giả.
              Historical depth yêu cầu vendor stream MBP-10 hoặc thời gian thu thập orderbook snapshots trực tiếp.
            </p>
            <button
              onClick={() => fetchHeatmapData()}
              className="mt-4 px-3 py-1.5 text-xs font-medium rounded bg-[#1C2630] hover:bg-[#2A3746] text-[#38BDF8] border border-[#334155] transition-colors"
            >
              Thử lại ngay
            </button>
          </div>
        )}

        {/* Loading Spinner */}
        {loading && snapshots.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#080B0E]/70">
            <div className="flex items-center gap-2 text-xs text-[#38BDF8]">
              <RefreshCw size={14} className="animate-spin" />
              <span>Đang tải MBP-10 depth history…</span>
            </div>
          </div>
        )}

        {/* Tooltip on Hover */}
        {hoveredPoint && (
          <div
            className="absolute pointer-events-none z-10 px-2 py-1.5 rounded bg-[#0F172A]/95 border border-[#334155] shadow-lg text-[11px] font-mono text-white flex flex-col gap-0.5"
            style={{
              left: Math.min(window.innerWidth - 180, hoveredPoint.x + 12),
              top: Math.max(10, hoveredPoint.y - 40),
            }}
          >
            <div className="flex items-center justify-between gap-3 text-[#94A3B8]">
              <span>Price:</span>
              <span className="font-bold text-[#E2E8F0]">{hoveredPoint.price.toFixed(2)}</span>
            </div>
            {hoveredPoint.bidSize !== undefined && (
              <div className="flex items-center justify-between gap-3 text-[#38BDF8]">
                <span>Bid Size:</span>
                <span className="font-bold">{hoveredPoint.bidSize}</span>
              </div>
            )}
            {hoveredPoint.askSize !== undefined && (
              <div className="flex items-center justify-between gap-3 text-[#FB7185]">
                <span>Ask Size:</span>
                <span className="font-bold">{hoveredPoint.askSize}</span>
              </div>
            )}
            {hoveredPoint.isWall && (
              <div className="text-[10px] text-[#F59E0B] font-semibold tracking-wide">
                ⚡ LIQUIDITY WALL ({wallThresholdMultiplier}x avg)
              </div>
            )}
            <div className="text-[9px] text-[#64748B] pt-0.5 border-t border-[#1E293B]">
              {new Date(hoveredPoint.time).toLocaleTimeString()}
            </div>
          </div>
        )}
      </div>

      {/* Footer Info Legend */}
      <div className="flex items-center justify-between px-3 py-1 border-t border-[#1C2630] bg-[#0A0D10] text-[10px] text-[#64748B] font-mono">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#0E7490]" /> Bids (Cyan/Blue)
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#C2410C]" /> Asks (Amber/Rose)
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm border border-[#38BDF8] bg-[#22D3EE]" /> Liquidity Wall
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full border border-dashed border-[#EF4444]" /> Data Gap
          </span>
        </div>
        <span>Drag to pan · Scroll to zoom · Zero-Mock</span>
      </div>
    </div>
  );
};

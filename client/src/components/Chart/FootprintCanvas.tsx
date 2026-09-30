import React, { useEffect, useRef, useState, useCallback } from 'react';
import { AbsorptionAlert, ChartViewport, DeepTrade, FootprintBar, GEXProfile, HistoricalBar, VWAPPoint } from '../../types';
import { historyBeforeLive } from '../../services/chartHistory';
import { formatPrice, formatVolume } from '../../services/priceFormat';
import {
  calculatePriceToY,
  calculateYToPrice,
  clampScale,
  findBarIndexByTime,
  getNicePriceStep,
} from '../../services/viewportMath';
import { ChartTooltip, TooltipData } from './ChartTooltip';
import { SignalFilters } from '../Navigation/ChartToolbar';

interface FootprintCanvasProps {
  bars: FootprintBar[];
  historyBars?: HistoricalBar[];
  currentPrice: number;
  vwapPoints: VWAPPoint[];
  deepTrades: DeepTrade[];
  absorptions: AbsorptionAlert[];
  gexProfile?: GEXProfile;
  showVWAP: boolean;
  showImbalances: boolean;
  showDeltaNumbers: boolean;
  signalFilters?: SignalFilters;
  tickSize?: number;
  clusterMultiplier?: 'auto' | 1 | 2 | 4 | 5 | 10 | 25 | 50;
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

interface ClusterRow {
  price: number;
  bidVol: number;
  askVol: number;
  delta: number;
  totalVol: number;
  hasBidImbalance: boolean;
  hasAskImbalance: boolean;
  hasStackedBidImbalance: boolean;
  hasStackedAskImbalance: boolean;
  isPOC: boolean;
}

const GUTTER_WIDTH = 76;
const FOOTER_HEIGHT = 38;

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
  signalFilters = { buyAbs: true, sellAbs: true, gamma: true, whale: true },
  tickSize = 0.25,
  clusterMultiplier = 'auto',
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Default viewport targeting 20-25 visible candles on screen (70px width + 10px spacing = 80px step)
  const [internalViewport, setInternalViewport] = useState<ChartViewport>({
    panX: 0,
    panY: 300,
    barWidth: 70,
    barSpacing: 10,
    priceScale: 16,
    autoFollow: true,
  });

  const viewport = propsViewport || internalViewport;
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

  const autoFollow = viewport.autoFollow ?? true;

  // Interaction refs
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const mousePosRef = useRef<{ x: number; y: number } | null>(null);
  const lastFittedDatasetRef = useRef<string | null>(null);

  // Dirty rendering scheduler: canvas renders only on dirty events (interactions, new data, resize)
  const isDirtyRef = useRef(true);
  const rafIdRef = useRef<number | null>(null);
  const renderCanvasRef = useRef<() => void>(() => {});

  const requestRender = useCallback(() => {
    isDirtyRef.current = true;
    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        if (isDirtyRef.current) {
          isDirtyRef.current = false;
          renderCanvasRef.current();
        }
      });
    }
  }, []);

  // Tooltip HUD state
  const [tooltipData, setTooltipData] = useState<TooltipData | null>(null);
  const [containerDimensions, setContainerDimensions] = useState({ width: 800, height: 600 });

  // Intelligent auto-scaling focused on 15–26 visible candles with clear order flow
  const fitViewport = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cssWidth = canvas.parentElement?.clientWidth || 800;
    const cssHeight = canvas.parentElement?.clientHeight || 600;
    const chartWidth = cssWidth - GUTTER_WIDTH;

    // Target 18-24 candles for market context & microstructure scanning
    const targetBarCount = Math.max(16, Math.min(26, Math.floor(chartWidth / 80)));
    let focusBars = bars.slice(-targetBarCount);
    if (focusBars.length === 0 && historyBars && historyBars.length > 0) {
      focusBars = historyBars.slice(-targetBarCount) as unknown as FootprintBar[];
    }

    let minPrice = Infinity;
    let maxPrice = -Infinity;

    for (const b of focusBars) {
      if (typeof b.high === 'number' && Number.isFinite(b.high) && b.high > maxPrice) maxPrice = b.high;
      if (typeof b.low === 'number' && Number.isFinite(b.low) && b.low < minPrice) minPrice = b.low;
    }

    const curP = currentPriceRef.current;
    if (typeof curP === 'number' && Number.isFinite(curP) && curP > 0) {
      if (curP > maxPrice) maxPrice = curP;
      if (curP < minPrice) minPrice = curP;
    }

    let anchor = curP && curP > 0 ? curP : 100;
    let newScale = viewportRef.current.priceScale;

    if (maxPrice > -Infinity && minPrice < Infinity) {
      anchor = (maxPrice + minPrice) / 2;
      const rawSpan = Math.max(maxPrice - minPrice, tickSize * 8);
      const usableHeight = (cssHeight - FOOTER_HEIGHT) * 0.72;
      const totalTicks = rawSpan / tickSize;
      const computedScale = usableHeight / Math.max(1, totalTicks);
      newScale = Math.max(10, Math.min(28, computedScale));
    }

    const barStep = 80;
    const totalWidth = bars.length * barStep;
    const targetPanX = bars.length > 0
      ? Math.min(chartWidth - 50, chartWidth - totalWidth - 40)
      : chartWidth - 50 + barStep;

    updateViewport((prev) => ({
      ...prev,
      anchorPrice: anchor,
      panY: (cssHeight - FOOTER_HEIGHT) / 2,
      panX: targetPanX,
      barWidth: 70,
      barSpacing: 10,
      priceScale: newScale,
      autoFollow: true,
    }));
  }, [bars, historyBars, tickSize, updateViewport]);

  // Fit the viewport once per dataset switch (symbol or timeframe switch)
  useEffect(() => {
    if (!symbol) return;
    const isReplayMode = sessionMode ? sessionMode !== 'LIVE' : !isLive;
    const datasetKey = `${symbol}:${timeframe || ''}:${isReplayMode ? 'replay' : 'live'}`;
    if (lastFittedDatasetRef.current === datasetKey && viewport.anchorPrice !== undefined) return;

    const hasPrice = typeof currentPrice === 'number' && currentPrice > 0;
    const hasBars = bars.length > 0 || (historyBars && historyBars.length > 0);
    if (!hasPrice && !hasBars) return;

    lastFittedDatasetRef.current = datasetKey;
    fitViewport();
  }, [symbol, timeframe, sessionMode, isLive, bars.length, historyBars, currentPrice, viewport.anchorPrice, fitViewport]);

  // Auto-follow: pins newest bar near the right edge
  useEffect(() => {
    if (!autoFollow) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cssWidth = canvas.parentElement?.clientWidth || 800;
    const chartWidth = cssWidth - GUTTER_WIDTH;
    const barStep = viewport.barWidth + viewport.barSpacing;
    const totalWidth = bars.length * barStep;
    const nextPanX = bars.length > 0
      ? chartWidth - totalWidth - 50
      : chartWidth - 50 + barStep;
    if (Math.abs(nextPanX - viewport.panX) > 1) {
      updateViewport((prev) => ({ ...prev, panX: nextPanX }));
    }
  }, [bars.length, autoFollow, viewport.barWidth, viewport.barSpacing, viewport.panX, updateViewport]);

  // Track parent resize
  useEffect(() => {
    const parent = canvasRef.current?.parentElement;
    if (!parent) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setContainerDimensions({ width, height });
        if (autoFollow) {
          const barStep = viewportRef.current.barWidth + viewportRef.current.barSpacing;
          const totalWidth = bars.length * barStep;
          updateViewport((prev) => ({ ...prev, panX: width - GUTTER_WIDTH - totalWidth - 50 }));
        }
      }
    });
    ro.observe(parent);
    return () => ro.disconnect();
  }, [autoFollow, bars.length, updateViewport]);

  // Convert Price to Canvas Y
  const priceToY = useCallback(
    (price: number) => {
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

  // Mouse interaction handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    isDraggingRef.current = true;
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: viewport.panX,
      panY: viewport.panY,
    };
    requestRender();
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const curX = e.clientX - rect.left;
    const curY = e.clientY - rect.top;
    mousePosRef.current = { x: curX, y: curY };
    requestRender();

    if (onCrosshairChange) {
      onCrosshairChange(curX < canvas.clientWidth - GUTTER_WIDTH ? curX : null);
    }

    if (isDraggingRef.current) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      const shouldDisableFollow = autoFollow && (Math.abs(dx) > 3 || Math.abs(dy) > 3);
      updateViewport((prev) => ({
        ...prev,
        autoFollow: shouldDisableFollow ? false : prev.autoFollow,
        panX: dragStartRef.current.panX + dx,
        panY: dragStartRef.current.panY + dy,
      }));
      setTooltipData(null);
      return;
    }

    // Check hover over attached signals first
    const barStep = viewport.barWidth + viewport.barSpacing;
    let hoveredSignalData: TooltipData | null = null;

    if (signalFilters.whale && deepTrades.length > 0) {
      for (const dt of deepTrades.slice(-25)) {
        const bIdx = findBarIndexByTime(dt.timestamp, bars);
        if (bIdx < 0 || bIdx >= bars.length) continue;
        const b = bars[bIdx];
        const bX = viewport.panX + bIdx * barStep;
        const bCenterX = bX + viewport.barWidth / 2;
        const isBuy = dt.side === 'buy';
        const highY = priceToY(b.high);
        const lowY = priceToY(b.low);
        const mY = isBuy ? (highY - 12) : (lowY + 12);
        if (Math.abs(curX - bCenterX) <= 9 && Math.abs(curY - mY) <= 9) {
          hoveredSignalData = {
            x: curX,
            y: curY,
            barX: bX,
            barWidth: viewport.barWidth,
            type: 'signal',
            title: `WHALE TRADE · ${symbol}`,
            price: dt.price,
            tickSize,
            size: dt.size,
            valueUsd: dt.valueUsd,
            side: dt.side,
            description: `Institutional block trade (${formatVolume(dt.size)} contracts)`,
          };
          break;
        }
      }
    }

    if (!hoveredSignalData && (signalFilters.buyAbs || signalFilters.sellAbs) && absorptions.length > 0) {
      for (const abs of absorptions.slice(-25)) {
        if (abs.side === 'buy_absorption' && !signalFilters.buyAbs) continue;
        if (abs.side === 'sell_absorption' && !signalFilters.sellAbs) continue;
        const bIdx = findBarIndexByTime(abs.timestamp, bars);
        if (bIdx < 0 || bIdx >= bars.length) continue;
        const b = bars[bIdx];
        const bX = viewport.panX + bIdx * barStep;
        const bCenterX = bX + viewport.barWidth / 2;
        const isBuy = abs.side === 'buy_absorption';
        const highY = priceToY(b.high);
        const lowY = priceToY(b.low);
        const mY = isBuy ? (lowY + 12) : (highY - 12);
        if (Math.abs(curX - bCenterX) <= 9 && Math.abs(curY - mY) <= 9) {
          hoveredSignalData = {
            x: curX,
            y: curY,
            barX: bX,
            barWidth: viewport.barWidth,
            type: 'signal',
            title: isBuy ? `BUY ABSORPTION · ${symbol}` : `SELL ABSORPTION · ${symbol}`,
            price: abs.price,
            tickSize,
            size: abs.volume,
            side: isBuy ? 'buy' : 'sell',
            description: abs.description,
          };
          break;
        }
      }
    }

    if (hoveredSignalData) {
      setTooltipData(hoveredSignalData);
      return;
    }

    // Check hover over footprint bars
    let hoveredBarIdx = -1;
    for (let i = 0; i < bars.length; i++) {
      const bX = viewport.panX + i * barStep;
      if (curX >= bX && curX <= bX + viewport.barWidth) {
        hoveredBarIdx = i;
        break;
      }
    }

    if (hoveredBarIdx >= 0 && curY < canvas.clientHeight - FOOTER_HEIGHT) {
      const bar = bars[hoveredBarIdx];
      const bX = viewport.panX + hoveredBarIdx * barStep;
      const hoveredPrice = yToPrice(curY);

      // Snapping to cluster step
      const baseTick = tickSize > 0 ? tickSize : 0.25;
      let clusterMultiplierNum = 1;
      if (!clusterMultiplier || clusterMultiplier === 'auto') {
        if (viewport.priceScale >= 9) {
          clusterMultiplierNum = 1;
        } else {
          const needed = Math.max(1, Math.ceil(11 / Math.max(0.05, viewport.priceScale)));
          clusterMultiplierNum = needed <= 1 ? 1 : needed <= 2 ? 2 : needed <= 4 ? 4 : needed <= 8 ? 5 : 10;
        }
      } else {
        clusterMultiplierNum = clusterMultiplier;
      }
      const clusterStep = clusterMultiplierNum * baseTick;
      const bucketPrice = Number((Math.round(hoveredPrice / clusterStep) * clusterStep).toFixed(6));

      // Resolve matching level in bar
      let matchingLvl = bar.levels[bucketPrice];
      if (!matchingLvl) {
        let closestDist = Infinity;
        for (const [pStr, lvl] of Object.entries(bar.levels)) {
          const p = Number(pStr);
          const dist = Math.abs(p - bucketPrice);
          if (dist < closestDist && dist <= clusterStep * 1.05) {
            closestDist = dist;
            matchingLvl = lvl;
          }
        }
      }

      if (matchingLvl) {
        setTooltipData({
          x: curX,
          y: curY,
          barX: bX,
          barWidth: viewport.barWidth,
          type: 'cell',
          title: `FOOTPRINT LEVEL · ${symbol}`,
          price: bucketPrice,
          tickSize,
          bidVol: matchingLvl.bidVol,
          askVol: matchingLvl.askVol,
          cellDelta: matchingLvl.delta,
          hasBidImbalance: matchingLvl.bidImbalance,
          hasAskImbalance: matchingLvl.askImbalance,
          hasStackedBidImbalance: matchingLvl.stackedBidImbalance,
          hasStackedAskImbalance: matchingLvl.stackedAskImbalance,
          isPOC: matchingLvl.isPOC || bar.poc === bucketPrice,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
          delta: bar.delta,
        });
      } else {
        setTooltipData({
          x: curX,
          y: curY,
          barX: bX,
          barWidth: viewport.barWidth,
          type: 'candle',
          title: `BAR SUMMARY · ${symbol}`,
          tickSize,
          time: bar.time,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
          delta: bar.delta,
          minDelta: bar.minDelta,
          maxDelta: bar.maxDelta,
          poc: bar.poc,
        });
      }
    } else {
      setTooltipData(null);
    }
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
    requestRender();
  };

  const handleMouseLeave = () => {
    isDraggingRef.current = false;
    mousePosRef.current = null;
    setTooltipData(null);
    if (onCrosshairChange) {
      onCrosshairChange(null);
    }
    requestRender();
  };

  // Double-click = reset/fit view
  const handleDoubleClick = () => {
    fitViewport();
    requestRender();
  };

  // Wheel zoom (Shift = Y price scale, Normal = X candle width)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.shiftKey) {
        const factor = e.deltaY < 0 ? 1.10 : 0.90;
        updateViewport((prev) => ({
          ...prev,
          priceScale: clampScale(prev.priceScale, factor, 1, 55),
        }));
      } else {
        const factor = e.deltaY < 0 ? 1.10 : 0.90;
        updateViewport((prev) => ({
          ...prev,
          barWidth: clampScale(prev.barWidth, factor, 40, 260),
        }));
      }
      requestRender();
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [updateViewport, requestRender]);

  // Main Canvas Render Logic (Dirty-flag driven, NO infinite 60fps loop)
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

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
      const chartWidth = width - GUTTER_WIDTH;
      const chartHeight = height - FOOTER_HEIGHT;

      // 1. Clear background (#080A0D)
      ctx.fillStyle = '#080A0D';
      ctx.fillRect(0, 0, width, height);

      // 2. Price Scale Gutter on Right (#0A0D12)
      ctx.fillStyle = '#0A0D12';
      ctx.fillRect(chartWidth, 0, GUTTER_WIDTH, height);
      ctx.strokeStyle = '#161D26';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(chartWidth, 0);
      ctx.lineTo(chartWidth, height);
      ctx.stroke();

      // 3. Bottom Axis Background & Separator
      ctx.fillStyle = '#080A0D';
      ctx.fillRect(0, chartHeight, width, FOOTER_HEIGHT);
      ctx.strokeStyle = '#161D26';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, chartHeight);
      ctx.lineTo(width, chartHeight);
      ctx.stroke();

      // 4. Subtle Price Grid Lines (Exact mathematical alignment with tickSize)
      const niceStep = getNicePriceStep(tickSize, viewport.priceScale, 32);
      const minVisiblePrice = yToPrice(chartHeight);
      const maxVisiblePrice = yToPrice(0);
      const startIdx = Math.floor(minVisiblePrice / niceStep);
      const endIdx = Math.ceil(maxVisiblePrice / niceStep);

      const curY = priceToY(currentPrice);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.lineWidth = 1;
      ctx.fillStyle = '#64748B';
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.textAlign = 'right';

      for (let i = startIdx; i <= endIdx; i++) {
        const p = Number((i * niceStep).toFixed(6));
        const y = priceToY(p);
        if (y < 12 || y > chartHeight - 12) continue;

        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(chartWidth, y);
        ctx.stroke();

        // Right Gutter Price Label - suppress if overlapping current price marker (within 13px)
        if (Math.abs(y - curY) > 13) {
          ctx.fillText(formatPrice(p, tickSize), width - 6, y + 3.5);
        }
      }

      // --- CLIP MAIN CHART DRAWING AREA (0, 0, chartWidth, chartHeight) ---
      // Ensures candles, wicks, clusters, POC, VWAP, signals, and gamma lines
      // never bleed into the right price gutter or bottom axis footer.
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, chartWidth, chartHeight);
      ctx.clip();

      // 5. Anchored VWAP Overlay (Secondary)
      if (showVWAP && vwapPoints.length > 0) {
        ctx.save();
        const barStep = viewport.barWidth + viewport.barSpacing;
        const vwapMap = new Map<number, VWAPPoint>();
        for (const vp of vwapPoints) {
          const minuteBucket = Math.floor(vp.time / 60000);
          vwapMap.set(minuteBucket, vp);
        }

        interface MatchedVwap {
          x: number;
          vwapY: number;
        }
        const matchedList: MatchedVwap[] = [];
        for (let i = 0; i < bars.length; i++) {
          const bar = bars[i];
          const barX = viewport.panX + i * barStep + viewport.barWidth / 2;
          if (barX < -50 || barX > chartWidth) continue;

          const minuteBucket = Math.floor(bar.time / 60000);
          let vp = vwapMap.get(minuteBucket);
          if (!vp) {
            vp = vwapMap.get(minuteBucket - 1) || vwapMap.get(minuteBucket + 1);
          }
          if (vp) {
            matchedList.push({
              x: barX,
              vwapY: priceToY(vp.vwap),
            });
          }
        }

        if (matchedList.length > 0) {
          ctx.strokeStyle = 'rgba(245, 185, 66, 0.45)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          matchedList.forEach((m, idx) => {
            if (idx === 0) ctx.moveTo(m.x, m.vwapY);
            else ctx.lineTo(m.x, m.vwapY);
          });
          ctx.stroke();
        }
        ctx.restore();
      }

      // 6. Draw Historical Bars (Left of Live Session)
      const history = historyBeforeLive(historyBars ?? [], bars);
      const barStep = viewport.barWidth + viewport.barSpacing;

      if (history.length > 0) {
        ctx.save();
        ctx.globalAlpha = 0.5;
        for (let i = 0; i < history.length; i++) {
          const bar = history[i];
          const barIndex = i - history.length;
          const barX = viewport.panX + barIndex * barStep;
          if (barX + viewport.barWidth < 0 || barX > chartWidth) continue;

          const isUp = bar.close >= bar.open;
          const color = isUp ? '#22C55E' : '#EF4444';
          const highY = priceToY(bar.high);
          const lowY = priceToY(bar.low);
          const openY = priceToY(bar.open);
          const closeY = priceToY(bar.close);

          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(barX + viewport.barWidth / 2, highY);
          ctx.lineTo(barX + viewport.barWidth / 2, lowY);
          ctx.stroke();

          const bodyTop = Math.min(openY, closeY);
          ctx.fillStyle = color;
          ctx.fillRect(barX + 2, bodyTop, viewport.barWidth - 4, Math.max(1, Math.abs(closeY - openY)));
        }

        if (bars.length > 0) {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = '#1E293B';
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(viewport.panX, 0);
          ctx.lineTo(viewport.panX, chartHeight);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.restore();
      }

      // 7. Core Footprint Price Ladder Engine
      // RULE #1: Footprint data IS the candle.
      // FOOTPRINT MUST NEVER TURN INTO A NORMAL CANDLE WHEN ZOOMED OUT.
      const baseTick = tickSize > 0 ? tickSize : 0.25;
      let clusterMultiplierNum = 1;
      if (!clusterMultiplier || clusterMultiplier === 'auto') {
        if (viewport.priceScale >= 9) {
          clusterMultiplierNum = 1;
        } else {
          const needed = Math.max(1, Math.ceil(11 / Math.max(0.05, viewport.priceScale)));
          clusterMultiplierNum = needed <= 1 ? 1 : needed <= 2 ? 2 : needed <= 4 ? 4 : needed <= 8 ? 5 : 10;
        }
      } else {
        clusterMultiplierNum = clusterMultiplier;
      }
      const clusterStep = clusterMultiplierNum * baseTick;

      const mousePos = mousePosRef.current;

      bars.forEach((bar, barIndex) => {
        const barX = viewport.panX + barIndex * barStep;
        if (barX + viewport.barWidth < 0 || barX > chartWidth) return;

        const isUp = bar.close >= bar.open;
        const barCenterX = barX + viewport.barWidth / 2;

        const highY = priceToY(bar.high);
        const lowY = priceToY(bar.low);
        const openY = priceToY(bar.open);
        const closeY = priceToY(bar.close);

        // A. Subtle hover vertical highlight column behind active candle
        if (mousePos && mousePos.x >= barX && mousePos.x <= barX + viewport.barWidth && mousePos.x < chartWidth) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.015)';
          ctx.fillRect(barX, 0, viewport.barWidth, chartHeight);
        }

        // B. Minimal OHLC Context:
        // High/low wick: 1px subtle hairline from high to low (muted, zero obstruction)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(barCenterX, highY);
        ctx.lineTo(barCenterX, lowY);
        ctx.stroke();

        // Tiny Open & Close indication ticks on candle edges
        const tickColor = isUp ? '#22C55E' : '#EF4444';
        ctx.strokeStyle = tickColor;
        ctx.lineWidth = 1.5;
        // Open tick (left edge)
        ctx.beginPath();
        ctx.moveTo(barX - 2.5, openY);
        ctx.lineTo(barX, openY);
        ctx.stroke();
        // Close tick (right edge)
        ctx.beginPath();
        ctx.moveTo(barX + viewport.barWidth, closeY);
        ctx.lineTo(barX + viewport.barWidth + 2.5, closeY);
        ctx.stroke();

        // When in traditional candle mode, render the solid candle body and skip footprint numbers ladder
        if (chartMode === 'candles') {
          const bodyTop = Math.min(openY, closeY);
          const bodyHeight = Math.max(1, Math.abs(closeY - openY));
          ctx.fillStyle = tickColor;
          ctx.fillRect(barX + 2, bodyTop, viewport.barWidth - 4, bodyHeight);
          return;
        }

        // C. Aggregate footprint price levels
        const buckets = new Map<number, ClusterRow>();
        for (const [pStr, lvl] of Object.entries(bar.levels)) {
          const p = Number(pStr);
          if (!lvl) continue;
          const bucketKey = Number((Math.round(p / clusterStep) * clusterStep).toFixed(6));
          let row = buckets.get(bucketKey);
          if (!row) {
            row = {
              price: bucketKey,
              bidVol: 0,
              askVol: 0,
              delta: 0,
              totalVol: 0,
              hasBidImbalance: false,
              hasAskImbalance: false,
              hasStackedBidImbalance: false,
              hasStackedAskImbalance: false,
              isPOC: false,
            };
            buckets.set(bucketKey, row);
          }
          row.bidVol += lvl.bidVol;
          row.askVol += lvl.askVol;
          row.delta += lvl.delta;
          row.totalVol += lvl.totalVol || (lvl.bidVol + lvl.askVol);
          if (lvl.bidImbalance) row.hasBidImbalance = true;
          if (lvl.askImbalance) row.hasAskImbalance = true;
          if (lvl.stackedBidImbalance) row.hasStackedBidImbalance = true;
          if (lvl.stackedAskImbalance) row.hasStackedAskImbalance = true;
          if (lvl.isPOC) row.isPOC = true;
        }

        const clusterRows = Array.from(buckets.values()).sort((a, b) => b.price - a.price);
        let maxTotal = 0;
        let highestVolRow: ClusterRow | null = null;
        for (const r of clusterRows) {
          if (r.totalVol > maxTotal) {
            maxTotal = r.totalVol;
            highestVolRow = r;
          }
        }
        if (highestVolRow) highestVolRow.isPOC = true;

        const maxClusterVol = Math.max(0.1, ...clusterRows.map((r) => Math.max(r.bidVol, r.askVol)));
        const cellWidth = Math.floor((viewport.barWidth - 1) / 2);

        // Center vertical divider (very subtle hairline)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.fillRect(barX + cellWidth, highY, 1, Math.max(1, lowY - highY));

        clusterRows.forEach((row) => {
          // Exact 1:1 mathematical centering on price scale
          const centerY = priceToY(row.price);
          const rowHeight = Math.max(2, (clusterStep / tickSize) * viewport.priceScale);
          const rowTop = centerY - rowHeight / 2;

          if (rowTop + rowHeight < 0 || rowTop > chartHeight) return;

          const isHoveredRow = mousePos &&
            mousePos.x >= barX && mousePos.x <= barX + viewport.barWidth &&
            mousePos.y >= rowTop && mousePos.y <= rowTop + rowHeight;

          // Extremely subtle volume intensity tint (never competes with numbers!)
          const bidRatio = Math.min(1, row.bidVol / maxClusterVol);
          const askRatio = Math.min(1, row.askVol / maxClusterVol);

          if (bidRatio > 0.06) {
            ctx.fillStyle = `rgba(239, 68, 68, ${0.03 + bidRatio * 0.08})`;
            const w = Math.min(cellWidth - 2, bidRatio * (cellWidth - 2));
            ctx.fillRect(barX + cellWidth - w, rowTop, w, rowHeight - 0.5);
          }

          if (askRatio > 0.06) {
            ctx.fillStyle = `rgba(34, 197, 94, ${0.03 + askRatio * 0.08})`;
            const w = Math.min(cellWidth - 2, askRatio * (cellWidth - 2));
            ctx.fillRect(barX + cellWidth + 1, rowTop, w, rowHeight - 0.5);
          }

          // Point of Control (POC): Subtle thin horizontal accent + slightly stronger text
          // P2: ~1px additional breathing room between POC number and POC accent line
          if (row.isPOC) {
            ctx.strokeStyle = 'rgba(245, 158, 11, 0.65)';
            ctx.lineWidth = 1;
            const pocLineY = Math.min(rowTop + rowHeight - 0.5, centerY + rowHeight / 2);
            ctx.beginPath();
            ctx.moveTo(barX + 2, pocLineY);
            ctx.lineTo(barX + viewport.barWidth - 2, pocLineY);
            ctx.stroke();
          }

          // Stacked Imbalance: P1 - 2.0px edge marker with clear intensity
          if (showImbalances) {
            if (row.hasStackedBidImbalance) {
              ctx.fillStyle = '#EF4444';
              ctx.fillRect(barX, rowTop, 2.0, rowHeight);
            }
            if (row.hasStackedAskImbalance) {
              ctx.fillStyle = '#22C55E';
              ctx.fillRect(barX + viewport.barWidth - 2.0, rowTop, 2.0, rowHeight);
            }
          }

          // Hover row outline
          if (isHoveredRow) {
            ctx.strokeStyle = 'rgba(34, 211, 238, 0.7)';
            ctx.lineWidth = 1;
            ctx.strokeRect(barX, rowTop, viewport.barWidth, rowHeight);
          }

          // High-contrast, clean monospace numbers
          // Elevated textY provides ~1px additional breathing room above POC accent line
          if (rowHeight >= 8 && viewport.barWidth >= 40) {
            const fontSize = Math.min(10, Math.max(8, Math.floor(rowHeight - 2)));
            const textY = centerY + fontSize * 0.26;

            // Bid Text (Right-aligned in Bid cell)
            ctx.textAlign = 'right';
            if (row.hasBidImbalance && showImbalances) {
              ctx.fillStyle = '#F87171';
              ctx.font = `600 ${fontSize}px JetBrains Mono, monospace`;
            } else if (row.isPOC) {
              ctx.fillStyle = '#FDE68A';
              ctx.font = `600 ${fontSize}px JetBrains Mono, monospace`;
            } else {
              ctx.fillStyle = '#94A3B8';
              ctx.font = `400 ${fontSize}px JetBrains Mono, monospace`;
            }
            ctx.fillText(formatVolume(row.bidVol), barX + cellWidth - 3, textY);

            // Ask Text (Left-aligned in Ask cell)
            ctx.textAlign = 'left';
            if (row.hasAskImbalance && showImbalances) {
              ctx.fillStyle = '#4ADE80';
              ctx.font = `600 ${fontSize}px JetBrains Mono, monospace`;
            } else if (row.isPOC) {
              ctx.fillStyle = '#FDE68A';
              ctx.font = `600 ${fontSize}px JetBrains Mono, monospace`;
            } else {
              ctx.fillStyle = '#94A3B8';
              ctx.font = `400 ${fontSize}px JetBrains Mono, monospace`;
            }
            ctx.fillText(formatVolume(row.askVol), barX + cellWidth + 4, textY);
          }
        });
      });

      // 8. Institutional Signals: Render attached to originating candle and price level
      // P0: Whale trades attached to candle/price
      if (signalFilters.whale && deepTrades.length > 0) {
        ctx.save();
        deepTrades.slice(-25).forEach((dt) => {
          const barIdx = findBarIndexByTime(dt.timestamp, bars);
          if (barIdx < 0 || barIdx >= bars.length) return;
          const bar = bars[barIdx];
          const barX = viewport.panX + barIdx * barStep;
          if (barX + viewport.barWidth < 0 || barX > chartWidth) return;

          const barCenterX = barX + viewport.barWidth / 2;
          const highY = priceToY(bar.high);
          const lowY = priceToY(bar.low);

          const isBuy = dt.side === 'buy';
          const markerY = isBuy ? (highY - 12) : (lowY + 12);
          if (markerY < 8 || markerY > chartHeight - 8) return;

          // Hairline stem connecting marker to candle
          ctx.strokeStyle = isBuy ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.4)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(barCenterX, isBuy ? highY : lowY);
          ctx.lineTo(barCenterX, isBuy ? markerY + 4 : markerY - 4);
          ctx.stroke();

          // Subtle ◆ marker
          ctx.fillStyle = isBuy ? '#22C55E' : '#EF4444';
          ctx.font = '700 8px JetBrains Mono, monospace';
          ctx.textAlign = 'center';
          ctx.fillText('◆', barCenterX, isBuy ? markerY + 3 : markerY + 2);
        });
        ctx.restore();
      }

      if ((signalFilters.buyAbs || signalFilters.sellAbs) && absorptions.length > 0) {
        ctx.save();
        absorptions.slice(-25).forEach((abs) => {
          if (abs.side === 'buy_absorption' && !signalFilters.buyAbs) return;
          if (abs.side === 'sell_absorption' && !signalFilters.sellAbs) return;

          const barIdx = findBarIndexByTime(abs.timestamp, bars);
          if (barIdx < 0 || barIdx >= bars.length) return;
          const bar = bars[barIdx];
          const barX = viewport.panX + barIdx * barStep;
          if (barX + viewport.barWidth < 0 || barX > chartWidth) return;

          const barCenterX = barX + viewport.barWidth / 2;
          const highY = priceToY(bar.high);
          const lowY = priceToY(bar.low);

          const isBuy = abs.side === 'buy_absorption';
          // Buy absorption: selling absorbed at lows -> ▲ below candle
          // Sell absorption: buying absorbed at highs -> ▼ above candle
          const markerY = isBuy ? (lowY + 12) : (highY - 12);
          if (markerY < 8 || markerY > chartHeight - 8) return;

          // Hairline stem connecting marker to candle
          ctx.strokeStyle = isBuy ? 'rgba(167, 139, 250, 0.45)' : 'rgba(244, 114, 182, 0.45)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(barCenterX, isBuy ? lowY : highY);
          ctx.lineTo(barCenterX, isBuy ? markerY - 4 : markerY + 4);
          ctx.stroke();

          // Subtle ▲ or ▼ marker
          ctx.fillStyle = isBuy ? '#A78BFA' : '#F472B6';
          ctx.font = '700 8px JetBrains Mono, monospace';
          ctx.textAlign = 'center';
          ctx.fillText(isBuy ? '▲' : '▼', barCenterX, isBuy ? markerY + 3 : markerY + 2);
        });
        ctx.restore();
      }

      // 9. Institutional Gamma Levels (Call Wall, Put Wall, Zero Gamma Flip)
      if (signalFilters.gamma && gexProfile) {
        ctx.save();
        ctx.setLineDash([4, 4]);

        // Call Wall
        const cwY = priceToY(gexProfile.callWall);
        if (cwY >= 0 && cwY <= chartHeight) {
          ctx.strokeStyle = '#22C55E';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, cwY);
          ctx.lineTo(chartWidth, cwY);
          ctx.stroke();

          ctx.fillStyle = '#22C55E';
          ctx.font = '9px JetBrains Mono, monospace';
          ctx.textAlign = 'left';
          ctx.fillText(`CALL WALL ${formatPrice(gexProfile.callWall, tickSize)}`, 28, cwY - 4);
        }

        // Put Wall
        const pwY = priceToY(gexProfile.putWall);
        if (pwY >= 0 && pwY <= chartHeight) {
          ctx.strokeStyle = '#EF4444';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, pwY);
          ctx.lineTo(chartWidth, pwY);
          ctx.stroke();

          ctx.fillStyle = '#EF4444';
          ctx.font = '9px JetBrains Mono, monospace';
          ctx.textAlign = 'left';
          ctx.fillText(`PUT WALL ${formatPrice(gexProfile.putWall, tickSize)}`, 28, pwY - 4);
        }

        // Zero Gamma Flip
        const zgY = priceToY(gexProfile.zeroGammaFlip);
        if (zgY >= 0 && zgY <= chartHeight) {
          ctx.strokeStyle = '#F5B942';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, zgY);
          ctx.lineTo(chartWidth, zgY);
          ctx.stroke();

          ctx.fillStyle = '#F5B942';
          ctx.font = '9px JetBrains Mono, monospace';
          ctx.textAlign = 'left';
          ctx.fillText(`ZERO GAMMA ${formatPrice(gexProfile.zeroGammaFlip, tickSize)}`, 28, zgY - 4);
        }
        ctx.restore();
      }

      // Close main chart clipping region
      ctx.restore();

      // --- COMPACT DELTA & VOLUME TEXT IN FOOTER (clipped to chartWidth) ---
      if (showDeltaNumbers) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, chartHeight, chartWidth, FOOTER_HEIGHT);
        ctx.clip();
        bars.forEach((bar, barIndex) => {
          const barX = viewport.panX + barIndex * barStep;
          if (barX + viewport.barWidth < 0 || barX > chartWidth) return;
          const barCenterX = barX + viewport.barWidth / 2;
          const deltaY = chartHeight + 14;
          const isPos = bar.delta >= 0;

          // Line 1: Delta text (clean integer)
          ctx.font = '600 10px JetBrains Mono, monospace';
          ctx.textAlign = 'center';
          ctx.fillStyle = isPos ? '#22C55E' : '#EF4444';
          ctx.fillText(`${isPos ? '+' : ''}${formatVolume(bar.delta)} Δ`, barCenterX, deltaY);

          // Line 2: Volume text (clean integer / K)
          ctx.font = '400 9px JetBrains Mono, monospace';
          ctx.fillStyle = '#64748B';
          ctx.fillText(formatVolume(bar.volume), barCenterX, deltaY + 13);
        });
        ctx.restore();
      }

      // 10. Clean Current Price Marker on Right Axis
      ctx.strokeStyle = 'rgba(245, 185, 66, 0.45)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(0, curY);
      ctx.lineTo(chartWidth, curY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Current Price Badge in Gutter
      ctx.fillStyle = '#F5B942';
      ctx.fillRect(chartWidth + 1, curY - 9, GUTTER_WIDTH - 2, 18);
      ctx.fillStyle = '#080A0D';
      ctx.font = 'bold 10px JetBrains Mono, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(formatPrice(currentPrice, tickSize), width - 6, curY + 3.5);

      // 11. Crosshair & Hover Coordinate Display
      const activeX = crosshairX ?? mousePos?.x;
      const activeY = mousePos?.y;

      if (activeX !== null && activeX !== undefined && activeX < chartWidth) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);

        // Vertical line
        ctx.beginPath();
        ctx.moveTo(activeX, 0);
        ctx.lineTo(activeX, chartHeight);
        ctx.stroke();

        // Horizontal line & gutter price label
        if (activeY !== undefined && activeY < chartHeight) {
          ctx.beginPath();
          ctx.moveTo(0, activeY);
          ctx.lineTo(chartWidth, activeY);
          ctx.stroke();

          const hoverPrice = yToPrice(activeY);
          ctx.fillStyle = '#1E293B';
          ctx.fillRect(chartWidth + 1, activeY - 8, GUTTER_WIDTH - 2, 16);
          ctx.strokeStyle = '#22D3EE';
          ctx.strokeRect(chartWidth + 1, activeY - 8, GUTTER_WIDTH - 2, 16);
          ctx.fillStyle = '#FFFFFF';
          ctx.font = 'bold 9px JetBrains Mono, monospace';
          ctx.textAlign = 'right';
          ctx.fillText(formatPrice(hoverPrice, tickSize), width - 6, activeY + 3.5);
        }
        ctx.setLineDash([]);
      }
      // Frame rendered — no recursive animation loop!
    },
    [
      bars,
      historyBars,
      currentPrice,
      vwapPoints,
      deepTrades,
      absorptions,
      showVWAP,
      showImbalances,
      showDeltaNumbers,
      signalFilters,
      tickSize,
      viewport,
      gexProfile,
      priceToY,
      yToPrice,
      clusterMultiplier,
      crosshairX,
      chartMode,
    ]
  );

  // Synchronous render on data/viewport update ensures the canvas is never left blank
  useEffect(() => {
    renderCanvasRef.current = render;
    render();
  }, [render]);

  // Keep canvas rendered if tab visibility changes
  useEffect(() => {
    const handleVisibility = () => {
      if (!document.hidden) {
        render();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [render]);

  // Clean up any pending frame on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-[#080A0D] select-none"
    >
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onDoubleClick={handleDoubleClick}
        className="w-full h-full cursor-crosshair block"
      />

      {/* Interactive Microstructure HUD Tooltip */}
      <ChartTooltip
        data={tooltipData}
        containerWidth={containerDimensions.width}
        containerHeight={containerDimensions.height}
      />
    </div>
  );
};

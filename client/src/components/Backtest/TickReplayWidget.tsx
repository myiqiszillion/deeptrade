import React, { useState } from 'react';
import { wsClient } from '../../services/websocket';
import { ReplayProgress } from '../../types';
import { DataStatusStrip } from '../Status/DataStatusStrip';
import { Play, Pause, FastForward, StepForward, RotateCcw, Radio } from 'lucide-react';

interface TickReplayWidgetProps {
  progress?: ReplayProgress;
  symbol: string;
  feedStatus?: 'LIVE' | 'UNAVAILABLE';
  historySource: 'NONE' | 'REAL_TICKS' | 'REAL_BARS';
  gexSource?: 'CBOE_DELAYED' | 'LIVE';
}

export const TickReplayWidget: React.FC<TickReplayWidgetProps> = ({
  progress,
  symbol,
  feedStatus,
  historySource,
  gexSource,
}) => {
  const [localSpeed, setLocalSpeed] = useState<number>(1);
  const [hoverTick, setHoverTick] = useState<number | null>(null);

  // The server is the single source of truth for replay state.
  const isPlaying = progress?.isPlaying ?? false;
  const speed = progress?.speed ?? localSpeed;

  const handlePlayPause = () => {
    if (isPlaying) {
      wsClient.controlReplay('PAUSE');
    } else {
      wsClient.controlReplay('START', speed);
    }
  };

  const handleSpeedChange = (newSpeed: number) => {
    setLocalSpeed(newSpeed);
    wsClient.controlReplay('SET_SPEED', newSpeed);
  };

  const handleStepForward = () => {
    wsClient.stepReplay();
  };

  const handleReset = () => {
    wsClient.seekReplay(0);
  };

  const handleReturnToLive = () => {
    wsClient.returnToLive();
  };

  const calculateTickFromMouseEvent = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progress || progress.totalTicks <= 0) return null;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    return Math.floor(ratio * (progress.totalTicks - 1));
  };

  const handleProgressBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = calculateTickFromMouseEvent(e);
    if (target !== null) {
      wsClient.seekReplay(target);
    }
  };

  const handleProgressBarMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = calculateTickFromMouseEvent(e);
    setHoverTick(target);
  };

  const handleProgressBarMouseLeave = () => {
    setHoverTick(null);
  };

  return (
    <div className="flex shrink-0 items-center gap-3 px-3 py-1.5 bg-brand-surface border-t border-brand-border text-xs select-none overflow-x-auto whitespace-nowrap">
      <div className="flex items-center gap-1.5 font-bold text-amber-400">
        <FastForward size={14} />
        <span>REPLAY (ISOLATED)</span>
      </div>

      <div className="h-4 w-px bg-brand-border" />

      {/* Play / Pause / Step Controls */}
      <div className="flex items-center gap-1">
        <button
          onClick={handlePlayPause}
          className={`p-1.5 rounded font-semibold flex items-center gap-1 ${
            isPlaying ? 'bg-amber-600 text-white' : 'bg-brand-surfaceHover text-slate-200 hover:bg-slate-700'
          }`}
          title={isPlaying ? 'Pause Replay' : 'Play Replay'}
        >
          {isPlaying ? <Pause size={13} /> : <Play size={13} />}
          <span>{isPlaying ? 'PAUSE' : 'PLAY'}</span>
        </button>

        <button
          onClick={handleStepForward}
          disabled={isPlaying}
          className="p-1.5 rounded bg-brand-surfaceHover text-slate-300 hover:bg-slate-700 disabled:opacity-50"
          title="Step Next Tick"
        >
          <StepForward size={13} />
        </button>

        <button
          onClick={handleReset}
          className="p-1.5 rounded bg-brand-surfaceHover text-slate-300 hover:bg-slate-700"
          title="Reset to Start"
        >
          <RotateCcw size={13} />
        </button>

        <button
          onClick={handleReturnToLive}
          className="px-2 py-1 rounded font-semibold flex items-center gap-1 bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-600/50 hover:text-white transition-colors ml-1"
          title="Return to Live Market Stream"
        >
          <Radio size={12} className="animate-pulse" />
          <span>RETURN TO LIVE</span>
        </button>
      </div>

      <div className="h-4 w-px bg-brand-border" />

      {/* Speed Multipliers */}
      <div className="flex items-center gap-1">
        <span className="text-slate-500 text-[11px]">Speed:</span>
        {[1, 5, 10, 50, 100].map((s) => (
          <button
            key={s}
            onClick={() => handleSpeedChange(s)}
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
              speed === s ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 font-bold' : 'text-slate-400 hover:text-white'
            }`}
          >
            {s}x
          </button>
        ))}
      </div>

      <div className="flex-1" />

      {/* Interactive Playhead Scrub Bar */}
      <div className="flex items-center gap-3 text-[11px] text-slate-400">
        <span
          className={`inline-block w-2 h-2 rounded-full ${
            isPlaying ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)] animate-pulse' : 'bg-slate-600'
          }`}
          title={isPlaying ? 'Replay running' : 'Replay paused'}
        />
        <span className="font-mono text-slate-300">
          {progress ? `${progress.currentIndex} / ${progress.totalTicks} ticks` : 'buffer: —'}
        </span>

        <div
          onClick={handleProgressBarClick}
          onMouseMove={handleProgressBarMouseMove}
          onMouseLeave={handleProgressBarMouseLeave}
          className="relative w-36 sm:w-48 h-3 bg-slate-800/80 hover:bg-slate-800 rounded-full cursor-pointer flex items-center px-0.5 border border-white/5 transition-colors group"
          title={hoverTick !== null ? `Seek to tick ${hoverTick}` : 'Click to seek playhead'}
        >
          <div
            className="h-1.5 bg-gradient-to-r from-amber-500 to-amber-400 rounded-full pointer-events-none transition-[width] duration-75"
            style={{
              width: `${
                progress && progress.totalTicks > 0
                  ? Math.min(100, Math.max(0, (progress.currentIndex / progress.totalTicks) * 100))
                  : 0
              }%`,
            }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-amber-300 rounded-full shadow-[0_0_6px_rgba(245,158,11,0.8)] border border-slate-900 pointer-events-none transition-transform group-hover:scale-125"
            style={{
              left: `${
                progress && progress.totalTicks > 0
                  ? Math.min(96, Math.max(2, (progress.currentIndex / progress.totalTicks) * 100))
                  : 2
              }%`,
              transform: 'translate(-50%, -50%)',
            }}
          />
          {hoverTick !== null && progress && (
            <div
              className="absolute -top-7 px-1.5 py-0.5 rounded bg-slate-900 border border-amber-500/40 text-amber-300 text-[10px] font-mono shadow-lg pointer-events-none -translate-x-1/2 z-20"
              style={{
                left: `${(hoverTick / Math.max(1, progress.totalTicks - 1)) * 100}%`,
              }}
            >
              #{hoverTick}
            </div>
          )}
        </div>
      </div>

      <DataStatusStrip
        symbol={symbol}
        feedStatus={feedStatus}
        historySource={historySource}
        gexSource={gexSource}
      />
    </div>
  );
};

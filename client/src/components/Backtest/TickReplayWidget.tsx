import React, { useState } from 'react';
import { wsClient } from '../../services/websocket';
import { ReplayProgress } from '../../types';
import { DataStatusStrip } from '../Status/DataStatusStrip';
import { Play, Pause, FastForward, StepForward, RotateCcw } from 'lucide-react';

interface TickReplayWidgetProps {
  progress?: ReplayProgress;
  symbol: string;
  isCrypto: boolean;
  feedStatus?: 'LIVE' | 'UNAVAILABLE';
  historySource: 'NONE' | 'REAL_TICKS' | 'REAL_BARS';
  gexSource?: 'CBOE_DELAYED' | 'LIVE';
}

export const TickReplayWidget: React.FC<TickReplayWidgetProps> = ({
  progress,
  symbol,
  isCrypto,
  feedStatus,
  historySource,
  gexSource,
}) => {
  const [localSpeed, setLocalSpeed] = useState<number>(1);

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
    wsClient.controlReplay('SEEK', undefined, 0);
  };

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 bg-brand-surface border-t border-brand-border text-xs select-none">
      <div className="flex items-center gap-1.5 font-bold text-amber-400">
        <FastForward size={14} />
        <span>BACKTEST EVERY TICK</span>
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

      <div className="flex items-center gap-2 text-[11px] text-slate-400">
        <span className={`inline-block w-2 h-2 rounded-full ${isPlaying ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`} />
        <span className="font-mono">
          {progress ? `${progress.currentIndex} / ${progress.totalTicks} ticks` : 'buffer: —'}
        </span>
        <div className="w-24 h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-amber-500 transition-all"
            style={{
              width: `${progress && progress.totalTicks > 0 ? (progress.currentIndex / progress.totalTicks) * 100 : 0}%`,
            }}
          />
        </div>
      </div>

      <DataStatusStrip
        symbol={symbol}
        isCrypto={isCrypto}
        feedStatus={feedStatus}
        historySource={historySource}
        gexSource={gexSource}
      />
    </div>
  );
};

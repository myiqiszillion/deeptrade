import React from 'react';
import { PropAccountConfig, PropAccountState, TrailingMode } from '../../types';
import { wsClient } from '../../services/websocket';
import { ShieldCheck, Lock, Award, Target } from 'lucide-react';

interface PropRiskMonitorProps {
  state?: PropAccountState;
  config?: PropAccountConfig;
}

export const PropRiskMonitor: React.FC<PropRiskMonitorProps> = ({ state, config }) => {
  if (!state || !config) return null;

  const handleModeChange = (mode: TrailingMode) => {
    wsClient.send({ type: 'SET_PROP_TRAILING_MODE', mode });
  };

  const handleEmergencyFlatten = () => {
    wsClient.placeOrder('FLATTEN', 0);
  };

  const isTrailingDanger = state.trailingBufferPercent < 30;
  const isDailyLossDanger = state.dailyLossPercent < 30;

  return (
    <div className="flex items-center gap-4 px-4 py-1.5 bg-brand-surface border-b border-brand-border text-xs select-none">
      {/* Firm & Account Info */}
      <div className="flex items-center gap-2 font-bold">
        <ShieldCheck size={16} className="text-amber-400" />
        <span className="text-slate-100">{config.accountName}</span>
        <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-bold text-[10px]">
          {config.firmName}
        </span>
      </div>

      <div className="h-4 w-px bg-brand-border" />

      {/* Trailing Drawdown Mode Selector */}
      <div className="flex items-center gap-1 text-[11px]">
        <span className="text-slate-500">Trailing Mode:</span>
        <button
          onClick={() => handleModeChange('INTRADAY_PEAK')}
          className={`px-1.5 py-0.5 rounded font-mono text-[10px] ${
            config.trailingMode === 'INTRADAY_PEAK'
              ? 'bg-amber-500 text-black font-bold'
              : 'text-slate-400 hover:text-white'
          }`}
          title="Apex / Bulenox style: Trails intraday unrealized high-water mark"
        >
          Intraday Peak
        </button>
        <button
          onClick={() => handleModeChange('END_OF_DAY')}
          className={`px-1.5 py-0.5 rounded font-mono text-[10px] ${
            config.trailingMode === 'END_OF_DAY'
              ? 'bg-blue-500 text-white font-bold'
              : 'text-slate-400 hover:text-white'
          }`}
          title="Topstep / MFF style: Trails end-of-day realized balance"
        >
          End of Day
        </button>
      </div>

      <div className="h-4 w-px bg-brand-border" />

      {/* Trailing Drawdown Buffer Bar */}
      <div className="flex items-center gap-2 min-w-[170px]">
        <div className="flex flex-col flex-1">
          <div className="flex justify-between text-[10px]">
            <span className="text-slate-400">Trailing Buffer:</span>
            <span className={`font-mono font-bold ${isTrailingDanger ? 'text-rose-400' : 'text-emerald-400'}`}>
              ${state.trailingBufferRemaining.toFixed(0)}
            </span>
          </div>
          <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                isTrailingDanger ? 'bg-rose-500' : 'bg-emerald-500'
              }`}
              style={{ width: `${state.trailingBufferPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Daily Loss Limit Bar */}
      <div className="flex items-center gap-2 min-w-[150px]">
        <div className="flex flex-col flex-1">
          <div className="flex justify-between text-[10px]">
            <span className="text-slate-400">Daily Loss Left:</span>
            <span className={`font-mono font-bold ${isDailyLossDanger ? 'text-rose-400' : 'text-slate-200'}`}>
              ${state.dailyLossRemaining.toFixed(0)}
            </span>
          </div>
          <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                isDailyLossDanger ? 'bg-rose-500' : 'bg-blue-500'
              }`}
              style={{ width: `${state.dailyLossPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Consistency Rule Meter */}
      <div className="flex items-center gap-1.5 text-[11px] font-mono">
        <Target size={13} className="text-purple-400" />
        <span className="text-slate-400">Consistency:</span>
        <span
          className={`font-bold ${
            state.consistencyPercent > config.consistencyTargetPercent ? 'text-amber-400' : 'text-emerald-400'
          }`}
          title="Highest day profit % of total profits (Must stay under 30-40% for payout)"
        >
          {state.consistencyPercent}% / {config.consistencyTargetPercent}%
        </span>
      </div>

      {/* Profit Target Progress */}
      <div className="flex items-center gap-1.5 text-[11px] font-mono">
        <Award size={13} className="text-amber-400" />
        <span className="text-slate-400">Target:</span>
        <span className="text-amber-400 font-bold">
          {state.profitTargetProgressPercent.toFixed(0)}%
        </span>
      </div>

      <div className="flex-1" />

      {/* Emergency Flatten / Lockout indicator */}
      {state.isLockedOut ? (
        <div className="flex items-center gap-1.5">
          <span className="px-2.5 py-1 bg-rose-600 text-white font-bold rounded flex items-center gap-1 text-[11px]">
            <Lock size={12} /> ACCOUNT LOCKED OUT
          </span>
          <button
            onClick={() => wsClient.resetPropAccount()}
            className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/40 text-amber-300 font-bold rounded border border-amber-500/40 text-[10px]"
            title="Clear the lockout and reset the simulated prop account"
          >
            RESET ACCOUNT
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => wsClient.resetPropAccount()}
            className="px-2 py-1 bg-slate-700/40 hover:bg-slate-700 text-slate-300 font-semibold rounded text-[10px]"
            title="Reset the simulated prop account (balance, PnL, consistency)"
          >
            RESET
          </button>
          <button
            onClick={handleEmergencyFlatten}
            className="px-2.5 py-1 bg-rose-600/30 hover:bg-rose-600 text-rose-300 hover:text-white font-bold rounded border border-rose-500/40 text-[10px] transition-all"
          >
            EMERGENCY FLATTEN
          </button>
        </div>
      )}
    </div>
  );
};

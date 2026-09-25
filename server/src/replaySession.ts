import { BacktestReplayEngine } from './backtestEngine.js';
import { FootprintEngine } from './footprintEngine.js';
import { FuturesInstrument } from './futuresConfig.js';
import { ProfileEngine } from './profileEngine.js';
import { ChartSession } from './session.js';
import { Tick } from './types.js';
import { VWAPEngine } from './vwapEngine.js';
import { TIMEFRAMES } from './marketData/marketContext.js';

export interface ReplayDataSource {
  loadTicks(options: {
    provider: string;
    symbol: string;
    beforeTime?: number;
    beforeId?: string;
    limit?: number;
  }): Promise<Tick[]>;
}

/**
 * Isolated Replay Context per ChartSession.
 *
 * Runs its own Footprint, Profile, and VWAP engines. Never broadcasts to other sessions
 * and never pollutes the live market context.
 */
export class ReplaySession {
  public readonly replayEngine = new BacktestReplayEngine();
  public footprintEngine: FootprintEngine;
  public profileEngine: ProfileEngine;
  public vwapEngine: VWAPEngine;

  private progressInterval: NodeJS.Timeout | null = null;
  private lastProfileUpdate = 0;

  constructor(
    public readonly session: ChartSession,
    public readonly symbol: string,
    public readonly instrument: FuturesInstrument,
    public readonly timeframe: string,
    ticks: Tick[] = []
  ) {
    this.session.setMode('REPLAY');
    const durationMs = TIMEFRAMES[timeframe] || 60000;
    this.footprintEngine = new FootprintEngine(instrument.tickSize, durationMs, 3.0, 1.0, 3);
    const startTs = ticks[0]?.timestamp || 0;
    this.profileEngine = new ProfileEngine(instrument.tickSize, startTs);
    this.vwapEngine = new VWAPEngine(startTs);

    if (ticks.length > 0) {
      this.replayEngine.loadTicks(ticks);
    }

    this.replayEngine.setCallback((tick: Tick) => {
      const { currentBar, closedBar, correctedBar, affectedBars } = this.footprintEngine.processTick(tick);
      this.profileEngine.processTick(tick);
      const vwapPoint = this.vwapEngine.processTick(tick);

      this.session.send({ type: 'TICK', tick });
      if (affectedBars && affectedBars.length > 0) {
        for (const bar of affectedBars) {
          this.session.send({ type: 'BAR_UPDATE', bar });
        }
      } else {
        if (correctedBar) {
          this.session.send({ type: 'BAR_UPDATE', bar: correctedBar });
        }
        if (closedBar) {
          this.session.send({ type: 'BAR_CLOSE', bar: closedBar });
        }
        this.session.send({ type: 'BAR_UPDATE', bar: currentBar });
      }
      if (vwapPoint) {
        this.session.send({ type: 'VWAP_UPDATE', point: vwapPoint });
      }

      const now = Date.now();
      if (now - this.lastProfileUpdate > 500) {
        this.session.send({
          type: 'PROFILE_UPDATE',
          volumeProfile: this.profileEngine.getVolumeProfile(),
          tpo: this.profileEngine.getTPOProfile(),
        });
        this.lastProfileUpdate = now;
      }
    });

    this.replayEngine.setProgressCallback((progress) => {
      const isEnded = progress.currentIndex >= progress.totalTicks;
      const nextMode: 'REPLAY' | 'REPLAY_PAUSED' | 'REPLAY_ENDED' = isEnded
        ? 'REPLAY_ENDED'
        : progress.isPlaying
        ? 'REPLAY'
        : 'REPLAY_PAUSED';

      this.session.setMode(nextMode);
      if (isEnded) {
        this.sendProfileAndVwapUpdate();
      }

      this.session.send({
        type: 'REPLAY_STATE',
        progress: {
          ...progress,
          isEnded,
          mode: nextMode,
        },
      });
    });

    this.progressInterval = setInterval(() => {
      if (this.replayEngine.isActive()) {
        const progress = this.replayEngine.getProgress();
        const isEnded = progress.currentIndex >= progress.totalTicks;
        const nextMode = isEnded ? 'REPLAY_ENDED' : 'REPLAY';
        this.session.setMode(nextMode);
        this.session.send({
          type: 'REPLAY_STATE',
          progress: {
            ...progress,
            isEnded,
            mode: nextMode,
          },
        });
      }
    }, 500);

    // Send initial replay reset snapshot to clear client chart state
    this.sendReplayInitState();
  }

  /**
   * Asynchronously load ticks from a persistent ReplayDataSource.
   */
  public async loadFromSource(
    source: ReplayDataSource,
    options: { provider: string; beforeTime?: number; beforeId?: string; limit?: number }
  ): Promise<number> {
    const ticks = await source.loadTicks({
      provider: options.provider,
      symbol: this.symbol,
      beforeTime: options.beforeTime,
      beforeId: options.beforeId,
      limit: options.limit ?? 5000,
    });

    this.replayEngine.loadTicks(ticks);
    this.rebuildState();
    return ticks.length;
  }

  public sendProfileAndVwapUpdate(): void {
    this.session.send({
      type: 'PROFILE_UPDATE',
      volumeProfile: this.profileEngine.getVolumeProfile(),
      tpo: this.profileEngine.getTPOProfile(),
    });
  }

  public sendReplayInitState(): void {
    const bars = this.footprintEngine.getAllBars();
    const currentBar = this.footprintEngine.getCurrentBar();

    this.session.send({
      type: 'INIT_STATE',
      symbol: this.symbol,
      instrument: this.instrument,
      bars,
      orderbook: { bids: [], asks: [], timestamp: Date.now(), lastUpdateId: 0 },
      volumeProfile: this.profileEngine.getVolumeProfile(),
      tpo: this.profileEngine.getTPOProfile(),
      vwap: this.vwapEngine.getHistory(),
      cvdHistory: bars.map((b) => ({ time: b.time, cvd: b.cvd })),
      timeframe: this.timeframe,
      historySource: 'REAL_TICKS',
      feedStatus: 'UNAVAILABLE',
      mode: this.session.mode,
      deepTradeThresholdUsd: 50000,
    });
    if (currentBar) {
      this.session.send({ type: 'BAR_UPDATE', bar: currentBar });
    }
  }

  public start(speed = 1): void {
    this.session.setMode('REPLAY');
    this.replayEngine.start(speed);
  }

  public pause(): void {
    this.session.setMode('REPLAY_PAUSED');
    this.replayEngine.pause();
    this.sendProfileAndVwapUpdate();
  }

  public step(): void {
    this.lastProfileUpdate = 0;
    this.replayEngine.stepForward();
    const progress = this.replayEngine.getProgress();
    const isEnded = progress.currentIndex >= progress.totalTicks;
    this.session.setMode(isEnded ? 'REPLAY_ENDED' : 'REPLAY_PAUSED');
  }

  public setSpeed(speed: number): void {
    this.replayEngine.setSpeed(speed);
  }

  public seek(target: number): void {
    this.replayEngine.seek(target);
    const progress = this.replayEngine.getProgress();
    const isEnded = progress.currentIndex >= progress.totalTicks;
    this.session.setMode(isEnded ? 'REPLAY_ENDED' : 'REPLAY_PAUSED');
    this.rebuildState();
  }

  public rebuildState(): void {
    const durationMs = TIMEFRAMES[this.timeframe] || 60000;
    this.footprintEngine = new FootprintEngine(this.instrument.tickSize, durationMs, 3.0, 1.0, 3);
    const ticks = this.replayEngine.getRecordedTicks();
    const startTs = ticks[0]?.timestamp || 0;
    this.profileEngine = new ProfileEngine(this.instrument.tickSize, startTs);
    this.vwapEngine = new VWAPEngine(startTs);

    const upTo = this.replayEngine.getProgress().currentIndex;

    for (let i = 0; i < upTo; i++) {
      const t = ticks[i];
      this.footprintEngine.processTick(t);
      this.profileEngine.processTick(t);
      this.vwapEngine.processTick(t);
    }

    this.sendReplayInitState();
  }

  public dispose(): void {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
    this.replayEngine.setProgressCallback(() => {});
    this.replayEngine.setCallback(() => {});
    this.replayEngine.pause();
    this.replayEngine.dispose();
    this.session.setMode('LIVE');
  }
}

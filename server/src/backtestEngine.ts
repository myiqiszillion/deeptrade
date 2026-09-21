import { Tick } from './types.js';

export class BacktestReplayEngine {
  private recordedTicks: Tick[] = [];
  private isReplaying = false;
  private playbackIndex = 0;
  private playbackSpeed = 1; // 1x, 5x, 10x, 100x
  private onTickCallback: ((tick: Tick) => void) | null = null;
  private onProgressCallback: ((progress: { isPlaying: boolean; currentIndex: number; totalTicks: number; speed: number; currentTime?: number }) => void) | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;

  public setProgressCallback(callback: (progress: { isPlaying: boolean; currentIndex: number; totalTicks: number; speed: number; currentTime?: number }) => void) {
    this.onProgressCallback = callback;
  }

  private notifyProgress() {
    this.onProgressCallback?.(this.getProgress());
  }

  public isActive(): boolean {
    return this.isReplaying;
  }

  public recordTick(tick: Tick) {
    if (this.isReplaying) return; // Prevent infinite loop during replay
    this.recordedTicks.push(tick);
    // Keep up to 200,000 ticks in buffer for instant replay
    if (this.recordedTicks.length > 200000) {
      this.recordedTicks.shift();
    }
  }

  public getRecordedCount(): number {
    return this.recordedTicks.length;
  }

  public getRecordedTicks(): Tick[] {
    return this.recordedTicks;
  }

  public loadTicks(ticks: Tick[]) {
    this.recordedTicks = [...ticks];
    this.playbackIndex = 0;
    this.notifyProgress();
  }

  public setCallback(callback: (tick: Tick) => void) {
    this.onTickCallback = callback;
  }

  public start(speed = 1) {
    this.playbackSpeed = speed;
    this.isReplaying = true;
    this.notifyProgress();

    if (this.intervalTimer) clearInterval(this.intervalTimer);

    // Dynamic timer interval based on playback speed
    const stepIntervalMs = Math.max(10, Math.floor(100 / this.playbackSpeed));

    this.intervalTimer = setInterval(() => {
      if (!this.isReplaying || this.playbackIndex >= this.recordedTicks.length) {
        this.pause();
        return;
      }

      // Step multiple ticks if speed is high
      const ticksToEmit = Math.max(1, Math.floor(this.playbackSpeed / 5));
      for (let i = 0; i < ticksToEmit && this.playbackIndex < this.recordedTicks.length; i++) {
        const tick = this.recordedTicks[this.playbackIndex];
        this.playbackIndex++;
        if (this.onTickCallback) {
          this.onTickCallback(tick);
        }
      }
      this.notifyProgress();
    }, stepIntervalMs);
  }

  public pause() {
    this.isReplaying = false;
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    this.notifyProgress();
  }

  public stepForward(): Tick | null {
    this.pause();
    if (this.playbackIndex < this.recordedTicks.length) {
      const tick = this.recordedTicks[this.playbackIndex];
      this.playbackIndex++;
      if (this.onTickCallback) {
        this.onTickCallback(tick);
      }
      this.notifyProgress();
      return tick;
    }
    return null;
  }

  public seek(target: number) {
    this.pause();
    if (this.recordedTicks.length === 0) return;
    if (target > 1000000000) {
      // Treat as epoch timestamp, binary search for closest tick
      let low = 0;
      let high = this.recordedTicks.length - 1;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (this.recordedTicks[mid].timestamp < target) {
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      this.playbackIndex = Math.max(0, Math.min(this.recordedTicks.length, low));
    } else {
      const intTarget = Math.max(0, Math.min(this.recordedTicks.length, Math.floor(target)));
      this.playbackIndex = intTarget;
    }
    this.notifyProgress();
  }

  public setSpeed(speed: number) {
    this.playbackSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
    if (this.isReplaying) {
      this.start(this.playbackSpeed);
    } else {
      this.notifyProgress();
    }
  }

  public getProgress() {
    const isEnded = this.recordedTicks.length > 0 && this.playbackIndex >= this.recordedTicks.length;
    const currentTickTs =
      this.playbackIndex < this.recordedTicks.length
        ? this.recordedTicks[this.playbackIndex]?.timestamp
        : this.playbackIndex > 0
        ? this.recordedTicks[this.playbackIndex - 1]?.timestamp
        : 0;

    return {
      currentIndex: this.playbackIndex,
      totalTicks: this.recordedTicks.length,
      isPlaying: this.isReplaying,
      speed: this.playbackSpeed,
      currentTime: currentTickTs || 0,
      isEnded,
    };
  }

  public dispose(): void {
    this.onTickCallback = null;
    this.onProgressCallback = null;
    this.pause();
    this.recordedTicks = [];
  }
}

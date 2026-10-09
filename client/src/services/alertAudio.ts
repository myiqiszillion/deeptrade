/**
 * Web Audio API Alert Chime Synthesizer
 *
 * Produces crisp institutional auditory cues without external audio asset dependencies.
 * Respects browser autoplay policies by resuming AudioContext on user interaction.
 * Includes rate-limiting/cooldown to avoid audio spam during high-volatility bursts.
 */

class AlertAudioService {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private volume: number = 0.5;
  private lastPlayTs: number = 0;
  private readonly cooldownMs: number = 800; // Minimum interval between audio chimes

  constructor() {
    try {
      this.isMuted = localStorage.getItem('deepchart.alerts.muted') === 'true';
      const vol = parseFloat(localStorage.getItem('deepchart.alerts.volume') || '0.5');
      if (Number.isFinite(vol) && vol >= 0 && vol <= 1) {
        this.volume = vol;
      }
    } catch {
      // localStorage may fail in restricted sandboxes
    }
  }

  private initContext(): AudioContext | null {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    try {
      localStorage.setItem('deepchart.alerts.muted', String(muted));
    } catch {}
  }

  public getVolume(): number {
    return this.volume;
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    try {
      localStorage.setItem('deepchart.alerts.volume', String(this.volume));
    } catch {}
  }

  /**
   * Play alert sound based on severity level.
   * Throttled by cooldownMs to protect the user's ears.
   */
  public play(severity: 'INFO' | 'WARNING' | 'CRITICAL' = 'INFO'): void {
    if (this.isMuted || this.volume <= 0.01) return;

    const now = Date.now();
    if (now - this.lastPlayTs < this.cooldownMs) return;
    this.lastPlayTs = now;

    try {
      const ctx = this.initContext();
      if (!ctx) return;

      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(this.volume * 0.3, ctx.currentTime);
      masterGain.connect(ctx.destination);

      const currentTime = ctx.currentTime;

      if (severity === 'CRITICAL') {
        // High dual bell chime (880Hz -> 1320Hz)
        this.playTone(ctx, masterGain, 880, currentTime, 0.15);
        this.playTone(ctx, masterGain, 1320, currentTime + 0.12, 0.25);
      } else if (severity === 'WARNING') {
        // Warning chime (587.33Hz -> 880Hz)
        this.playTone(ctx, masterGain, 587.33, currentTime, 0.15);
        this.playTone(ctx, masterGain, 880, currentTime + 0.1, 0.2);
      } else {
        // Gentle single ping (659.25Hz E5)
        this.playTone(ctx, masterGain, 659.25, currentTime, 0.2);
      }
    } catch (err) {
      console.debug('[AlertAudio] Failed to play audio:', err);
    }
  }

  private playTone(
    ctx: AudioContext,
    destination: AudioNode,
    freq: number,
    startTime: number,
    duration: number
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startTime);

    // Exponential decay envelope
    gain.gain.setValueAtTime(1.0, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    osc.connect(gain);
    gain.connect(destination);

    osc.start(startTime);
    osc.stop(startTime + duration);
  }
}

export const alertAudio = new AlertAudioService();

import { IncomingMessage } from 'node:http';

/**
 * Bounded, in-memory sliding-window limiter.
 *
 * A public server cannot trust any single peer: this bounds per-IP HTTP traffic, per-user vendor
 * spend and login attempts. Keys are evicted when their window empties, and the map is hard-capped
 * so a spoofed-key flood cannot grow memory without limit.
 */
export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 20000
  ) {}

  /** Record one hit; returns false when the caller is over the limit. */
  public hit(key: string, now = Date.now()): { allowed: boolean; retryAfterSec: number } {
    let timestamps = this.hits.get(key);
    if (!timestamps) {
      if (this.hits.size >= this.maxKeys) this.evictOldest(now);
      timestamps = [];
      this.hits.set(key, timestamps);
    }

    const cutoff = now - this.windowMs;
    while (timestamps.length > 0 && timestamps[0] <= cutoff) timestamps.shift();

    if (timestamps.length >= this.limit) {
      const oldest = timestamps[0];
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000)) };
    }

    timestamps.push(now);
    return { allowed: true, retryAfterSec: 0 };
  }

  /** Inspect without consuming quota. */
  public peek(key: string, now = Date.now()): number {
    const timestamps = this.hits.get(key);
    if (!timestamps) return 0;
    const cutoff = now - this.windowMs;
    return timestamps.filter((t) => t > cutoff).length;
  }

  public reset(key: string): void {
    this.hits.delete(key);
  }

  public clear(): void {
    this.hits.clear();
  }

  public get size(): number {
    return this.hits.size;
  }

  private evictOldest(now: number): void {
    const cutoff = now - this.windowMs;
    for (const [key, timestamps] of this.hits) {
      if (timestamps.length === 0 || timestamps[timestamps.length - 1] <= cutoff) this.hits.delete(key);
      if (this.hits.size < this.maxKeys) return;
    }
    // Still full: drop the oldest inserted key.
    const first = this.hits.keys().next().value;
    if (first !== undefined) this.hits.delete(first);
  }
}

/** Best-effort client IP. Honours X-Forwarded-For only when the operator trusts a proxy. */
export function clientIpFrom(req: IncomingMessage, trustProxy = process.env.TRUST_PROXY === '1'): string {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (typeof value === 'string' && value.trim()) {
      const first = value.split(',')[0].trim();
      if (first) return first;
    }
  }
  return req.socket?.remoteAddress || 'unknown';
}

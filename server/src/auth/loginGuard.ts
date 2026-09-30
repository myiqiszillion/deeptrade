/**
 * Brute-force protection for credential endpoints.
 *
 * Failures are counted per key (username and client IP independently), so an attacker who rotates
 * usernames from one IP is throttled, and an attacker who rotates IPs against one account is too.
 */
export interface LoginGuardDecision {
  locked: boolean;
  retryAfterSec: number;
}

interface FailureWindow {
  count: number;
  first: number;
  lockedUntil: number;
}

export class LoginGuard {
  private failures = new Map<string, FailureWindow>();

  constructor(
    private readonly maxFailures = 5,
    private readonly windowMs = 15 * 60_000,
    private readonly lockMs = 15 * 60_000,
    private readonly maxKeys = 20000
  ) {}

  public check(keys: string[], now = Date.now()): LoginGuardDecision {
    for (const key of keys) {
      const entry = this.failures.get(key);
      if (entry && entry.lockedUntil > now) {
        return { locked: true, retryAfterSec: Math.ceil((entry.lockedUntil - now) / 1000) };
      }
    }
    return { locked: false, retryAfterSec: 0 };
  }

  public recordFailure(keys: string[], now = Date.now()): void {
    for (const key of keys) {
      const entry = this.failures.get(key);
      if (!entry || now - entry.first > this.windowMs) {
        this.failures.set(key, { count: 1, first: now, lockedUntil: 0 });
      } else {
        entry.count += 1;
        if (entry.count >= this.maxFailures) {
          entry.lockedUntil = now + this.lockMs;
          entry.count = 0;
          entry.first = now;
        }
      }
      if (this.failures.size > this.maxKeys) {
        const first = this.failures.keys().next().value;
        if (first !== undefined) this.failures.delete(first);
      }
    }
  }

  public recordSuccess(keys: string[]): void {
    for (const key of keys) this.failures.delete(key);
  }

  public clear(): void {
    this.failures.clear();
  }

  public get size(): number {
    return this.failures.size;
  }
}

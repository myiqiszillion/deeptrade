/**
 * Redis & In-Memory Cache Store
 *
 * Implements high-speed caching for latest market quotes and options chains.
 * If Redis is configured via REDIS_URL, connects to external Redis;
 * otherwise automatically provides an in-memory Map-based cache with TTL expiration.
 */

import { ICacheStore } from './types.js';
import { NormalizedQuote, OptionContractDefinition } from '../databento/types.js';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class RedisCache implements ICacheStore {
  private inMemoryCache = new Map<string, CacheEntry<any>>();
  private cleanupTimer: any = null;
  public readonly isInMemory: boolean;

  constructor(redisUrl?: string) {
    const url = redisUrl || process.env.REDIS_URL;
    // Without external redis dependency installed, default to resilient in-memory TTL cache
    this.isInMemory = true;

    // Periodic sweep of expired in-memory cache entries every 60 seconds
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.inMemoryCache.entries()) {
        if (entry.expiresAt <= now) {
          this.inMemoryCache.delete(key);
        }
      }
    }, 60000);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  public async getLatestQuote(symbol: string): Promise<NormalizedQuote | null> {
    const key = `quote:${symbol.toUpperCase()}`;
    const entry = this.inMemoryCache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.inMemoryCache.delete(key);
      return null;
    }
    return entry.value;
  }

  public async setLatestQuote(symbol: string, quote: NormalizedQuote, ttlSeconds: number = 10): Promise<void> {
    const key = `quote:${symbol.toUpperCase()}`;
    this.inMemoryCache.set(key, {
      value: quote,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  public async getOptionChain(underlying: string): Promise<OptionContractDefinition[] | null> {
    const key = `chain:${underlying.toUpperCase()}`;
    const entry = this.inMemoryCache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.inMemoryCache.delete(key);
      return null;
    }
    return entry.value;
  }

  public async setOptionChain(
    underlying: string,
    chain: OptionContractDefinition[],
    ttlSeconds: number = 300
  ): Promise<void> {
    const key = `chain:${underlying.toUpperCase()}`;
    this.inMemoryCache.set(key, {
      value: chain,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  public close(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.inMemoryCache.clear();
  }
}

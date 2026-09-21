import { FUTURES_INSTRUMENTS, parseContractSymbol } from '../futuresConfig.js';
import { DataType, Entitlement } from './types.js';

type RevocationListener = (userId: string, revokedEntitlement: Entitlement) => void;

export class EntitlementService {
  private entitlements = new Map<string, Entitlement[]>(); // userId -> Entitlement[]
  private revocationListeners: RevocationListener[] = [];

  /**
   * Grant an entitlement to a user.
   */
  public grant(entitlement: Entitlement): void {
    const list = this.entitlements.get(entitlement.userId) || [];
    // Replace if same ID exists
    const idx = list.findIndex((e) => e.id === entitlement.id);
    if (idx >= 0) {
      list[idx] = entitlement;
    } else {
      list.push(entitlement);
    }
    this.entitlements.set(entitlement.userId, list);
  }

  /**
   * Revoke an entitlement by ID for a user.
   */
  public revoke(userId: string, entitlementId: string): boolean {
    const list = this.entitlements.get(userId);
    if (!list) return false;

    const idx = list.findIndex((e) => e.id === entitlementId);
    if (idx === -1) return false;

    const [removed] = list.splice(idx, 1);
    this.entitlements.set(userId, list);

    for (const listener of this.revocationListeners) {
      try {
        listener(userId, removed);
      } catch (err) {
        console.error('[EntitlementService] Error in revocation listener:', err);
      }
    }
    return true;
  }

  /**
   * Revoke all entitlements for a user (e.g. account suspension).
   */
  public revokeAll(userId: string): void {
    const list = this.entitlements.get(userId) || [];
    this.entitlements.delete(userId);
    for (const ent of list) {
      for (const listener of this.revocationListeners) {
        try {
          listener(userId, ent);
        } catch (err) {
          console.error('[EntitlementService] Error in revocation listener:', err);
        }
      }
    }
  }

  /**
   * Get all active entitlements for a user.
   */
  public getUserEntitlements(userId: string): Entitlement[] {
    const now = Date.now();
    const list = this.entitlements.get(userId) || [];
    return list.filter((e) => e.validUntil > now);
  }

  /**
   * Check whether a user is entitled to receive data for a given symbol and data type.
   * FAIL-CLOSED: returns false if user has no matching valid entitlement.
   */
  public hasEntitlement(userId: string, symbol: string, dataType: DataType): boolean {
    if (!userId || !symbol) return false;

    const parsed = parseContractSymbol(symbol);
    const instrument = FUTURES_INSTRUMENTS[symbol] || FUTURES_INSTRUMENTS[parsed.root];
    if (!instrument) return false;

    const activeList = this.getUserEntitlements(userId);
    if (activeList.length === 0) return false;

    for (const ent of activeList) {
      // 1. Check data type
      const hasType = ent.dataTypes.includes('*') || ent.dataTypes.includes(dataType);
      if (!hasType) continue;

      // 2. Check provider scope
      if (ent.provider !== '*') {
        const entProv = ent.provider.toLowerCase();
        if (instrument.exchange === 'BINANCE') {
          if (entProv !== 'binance') continue;
        } else {
          const validFuturesProviders = new Set([
            'cme',
            'cbot',
            'nymex',
            'comex',
            'tradovate',
            'databento',
            instrument.exchange.toLowerCase(),
            (process.env.FUTURES_PROVIDER || '').toLowerCase(),
          ]);
          if (!validFuturesProviders.has(entProv)) continue;
        }
      }

      // 3. Check exchange scope
      if (ent.exchange && ent.exchange !== '*' && ent.exchange.toUpperCase() !== instrument.exchange.toUpperCase()) {
        continue;
      }

      // 4. Check symbol pattern
      if (ent.symbolPattern && ent.symbolPattern !== '*') {
        const pattern = ent.symbolPattern.toUpperCase();
        if (pattern.endsWith('*')) {
          const prefix = pattern.slice(0, -1);
          if (!symbol.toUpperCase().startsWith(prefix)) continue;
        } else if (
          symbol.toUpperCase() !== pattern &&
          parsed.root.toUpperCase() !== pattern
        ) {
          continue;
        }
      }

      // All criteria met!
      return true;
    }

    return false;
  }

  /**
   * Register a callback triggered when an entitlement is revoked.
   */
  public onRevocation(listener: RevocationListener): () => void {
    this.revocationListeners.push(listener);
    return () => {
      this.revocationListeners = this.revocationListeners.filter((l) => l !== listener);
    };
  }

  /**
   * Clear all entitlements (primarily for tests).
   */
  public clear(): void {
    this.entitlements.clear();
    this.revocationListeners = [];
  }
}

export const entitlementService = new EntitlementService();

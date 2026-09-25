import { DataType, User } from './types.js';
import { entitlementService } from './entitlementService.js';

export interface AuthorizationContext {
  user: User | null;
  symbol: string;
  provider?: string;
  dataType: DataType;
}

export class AccessPolicy {
  /**
   * Centralized access policy evaluation.
   *
   * Rules:
   * 1. Suspended users are always denied.
   * 2. Development bypass is strictly bounded to non-production environments with DEV_HOOKS=1.
   * 3. BTCUSDT public demo access is permitted only when AUTH_REQUIRED !== '1'.
   * 4. In all other scenarios, user must be active and have a matching, non-expired entitlement.
   */
  public static isAuthorized(ctx: AuthorizationContext): boolean {
    const { user, symbol, dataType } = ctx;

    // 1. Suspended users are unconditionally rejected
    if (user && user.status === 'suspended') {
      return false;
    }

    // 2. Explicit development bypass (NEVER allowed in production)
    const isDev = process.env.NODE_ENV !== 'production';
    if (isDev && process.env.DEV_HOOKS === '1' && process.env.AUTH_REQUIRED !== '1') {
      return true;
    }

    // 3. Public crypto tier for BTCUSDT when auth is not strictly enforced
    const isFreeCrypto = symbol.toUpperCase() === 'BTCUSDT' && process.env.AUTH_REQUIRED !== '1';
    if (isFreeCrypto) {
      return true;
    }

    // 4. Strict entitlement check
    if (!user) {
      return false;
    }

    return entitlementService.hasEntitlement(user.id, symbol, dataType);
  }
}

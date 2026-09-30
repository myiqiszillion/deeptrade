import { DataType } from '../auth/types.js';

export type PlanId = 'free' | 'pro' | 'elite';
export type SubscriptionStatus = 'active' | 'past_due' | 'canceled';

/**
 * One row per paying (or free) account.
 *
 * Entitlements are derived from the plan catalog, never from the client: the browser can only ask
 * for a plan, the payment provider (or an admin) is what actually grants it.
 */
export interface Subscription {
  userId: string;
  planId: PlanId;
  status: SubscriptionStatus;
  /** Epoch ms — entitlements generated for this subscription expire with it. */
  currentPeriodEnd: number;
  provider: 'manual' | 'stripe' | 'trial';
  providerRef?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PlanDefinition {
  id: PlanId;
  name: string;
  priceUsdMonthly: number;
  /** Symbol patterns granted to the plan ('*' = every configured instrument). */
  symbolPatterns: string[];
  dataTypes: DataType[];
  /** Product promise shown in the UI; enforced by session/history caps. */
  maxConcurrentSessions: number;
  historyDays: number;
  features: string[];
}

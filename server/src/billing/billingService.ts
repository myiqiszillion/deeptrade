import { entitlementService } from '../auth/entitlementService.js';
import { User } from '../auth/types.js';
import { marketDataStore } from '../storage/marketDataStore.js';
import { DEFAULT_PLAN_ID, getPlan } from './plans.js';
import { PlanDefinition, PlanId, Subscription, SubscriptionStatus } from './types.js';

const ENTITLEMENT_PREFIX = 'plan';
const DEFAULT_PERIOD_MS = 31 * 24 * 60 * 60 * 1000;

/** Prefixed id so plan entitlements can be replaced without touching manual grants. */
function entitlementId(userId: string, planId: PlanId, index: number): string {
  return `${ENTITLEMENT_PREFIX}:${userId}:${planId}:${index}`;
}

export interface ApplyPlanOptions {
  validUntil?: number;
  provider?: Subscription['provider'];
  providerRef?: string;
  status?: SubscriptionStatus;
}

/**
 * Grant (or replace) the entitlements a plan unlocks.
 *
 * PLAN entitlements are prefixed and fully replaced, so downgrading revokes the wider symbols and
 * data types immediately; manually granted entitlements (admin gifts) are untouched because their
 * ids do not carry the prefix.
 */
export class BillingService {
  public applyPlan(user: User, planId: PlanId, options: ApplyPlanOptions = {}): Subscription | null {
    const plan = getPlan(planId);
    if (!plan) return null;

    const now = Date.now();
    const currentPeriodEnd = options.validUntil ?? now + DEFAULT_PERIOD_MS;

    for (const existing of entitlementService.getUserEntitlements(user.id)) {
      if (existing.id.startsWith(`${ENTITLEMENT_PREFIX}:`)) {
        entitlementService.revoke(user.id, existing.id);
      }
    }

    let index = 0;
    for (const provider of this.providerScope()) {
      for (const pattern of plan.symbolPatterns) {
        entitlementService.grant({
          id: entitlementId(user.id, plan.id, index),
          userId: user.id,
          provider,
          exchange: '*',
          symbolPattern: pattern,
          dataTypes: plan.dataTypes,
          validUntil: currentPeriodEnd,
          createdAt: now,
        });
        index += 1;
      }
    }

    const previous = this.getSubscription(user.id);
    const subscription: Subscription = {
      userId: user.id,
      planId: plan.id,
      status: options.status ?? 'active',
      currentPeriodEnd,
      provider: options.provider ?? 'manual',
      providerRef: options.providerRef,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    marketDataStore.saveSubscription(subscription);
    return subscription;
  }

  private toSubscription(stored: {
    userId: string;
    planId: string;
    status: string;
    currentPeriodEnd: number;
    provider: string;
    providerRef?: string;
    createdAt: number;
    updatedAt: number;
  } | null): Subscription | null {
    if (!stored) return null;
    if (!getPlan(stored.planId)) return null;
    const status: SubscriptionStatus =
      stored.status === 'past_due' || stored.status === 'canceled' ? stored.status : 'active';
    const provider: Subscription['provider'] =
      stored.provider === 'stripe' || stored.provider === 'trial' ? stored.provider : 'manual';
    return {
      userId: stored.userId,
      planId: stored.planId as PlanId,
      status,
      currentPeriodEnd: stored.currentPeriodEnd,
      provider,
      providerRef: stored.providerRef,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
    };
  }

  public getSubscription(userId: string): Subscription | null {
    return this.toSubscription(marketDataStore.getSubscription(userId));
  }

  /** Plan that is actually in force right now (falls back to the free tier). */
  public getEffectivePlan(userId: string): { subscription: Subscription | null; plan: PlanDefinition } {
    const subscription = this.getSubscription(userId);
    if (subscription && subscription.status !== 'canceled' && subscription.currentPeriodEnd > Date.now()) {
      const plan = getPlan(subscription.planId);
      if (plan) return { subscription, plan };
    }
    return { subscription, plan: getPlan(DEFAULT_PLAN_ID)! };
  }

  public cancelSubscription(userId: string, options: { immediate?: boolean } = {}): Subscription | null {
    const existing = this.getSubscription(userId);
    if (!existing) return null;
    const now = Date.now();
    const updated: Subscription = {
      ...existing,
      status: 'canceled',
      currentPeriodEnd: options.immediate ? now : existing.currentPeriodEnd,
      updatedAt: now,
    };
    marketDataStore.saveSubscription(updated);
    if (options.immediate) {
      for (const ent of entitlementService.getUserEntitlements(userId)) {
        if (ent.id.startsWith(`${ENTITLEMENT_PREFIX}:`)) entitlementService.revoke(userId, ent.id);
      }
    }
    return updated;
  }

  /** Providers a plan entitlement should cover: every configured vendor plus the exchange roots. */
  private providerScope(): string[] {
    const configured = (process.env.FUTURES_PROVIDER || '').trim().toLowerCase();
    const scope = new Set<string>(['*']);
    if (configured && configured !== 'none') scope.add(configured);
    return Array.from(scope);
  }
}

export const billingService = new BillingService();

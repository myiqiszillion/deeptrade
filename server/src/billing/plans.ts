import { PlanDefinition, PlanId } from './types.js';

/**
 * Plan catalog — the single source of truth for what each paid tier unlocks.
 *
 * Editing this file is the only supported way to change commercial packaging: entitlements are
 * always derived from here (see billingService.applyPlan), so the client can never widen its own
 * access by asking nicely.
 */
export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free',
    name: 'Free',
    priceUsdMonthly: 0,
    symbolPatterns: ['*'],
    dataTypes: ['BARS', 'TICKS', 'FOOTPRINT', 'REPLAY'],
    maxConcurrentSessions: 1,
    historyDays: 30,
    features: ['Footprint & candles', 'DOM ladder (view only)', 'Market replay', '1 session'],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceUsdMonthly: 49,
    symbolPatterns: ['*'],
    dataTypes: ['BARS', 'TICKS', 'FOOTPRINT', 'REPLAY', 'L2_BOOK'],
    maxConcurrentSessions: 3,
    historyDays: 180,
    features: ['Everything in Free', 'Full depth of book', 'Priority session slots', '3 sessions'],
  },
  elite: {
    id: 'elite',
    name: 'Elite',
    priceUsdMonthly: 149,
    symbolPatterns: ['*'],
    dataTypes: ['*'],
    maxConcurrentSessions: 5,
    historyDays: 365,
    features: ['Everything in Pro', 'MBO / full tick history', 'Highest session limit', '5 sessions'],
  },
};

export const DEFAULT_PLAN_ID: PlanId = 'free';

export function getPlan(planId: string | null | undefined): PlanDefinition | null {
  if (!planId) return null;
  return (PLANS as Record<string, PlanDefinition>)[planId] ?? null;
}

export function listPlans(): PlanDefinition[] {
  return Object.values(PLANS);
}

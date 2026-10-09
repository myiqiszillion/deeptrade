/**
 * Order Flow Alert Service
 *
 * Implements business logic, plan-based entitlement limits, rule validation,
 * and CRUD operations for Order Flow alert rules.
 */

import { randomUUID } from 'node:crypto';
import { FUTURES_INSTRUMENTS } from '../futuresConfig.js';
import { marketDataStore } from '../storage/marketDataStore.js';
import { AlertRule, CreateAlertRuleInput, UpdateAlertRuleInput, AlertHistoryItem } from './types.js';

export class AlertService {
  /**
   * Maximum allowed rules by user plan
   */
  public getMaxRulesForPlan(planId = 'free'): number {
    switch (planId.toLowerCase()) {
      case 'elite':
        return 100;
      case 'pro':
        return 15;
      case 'free':
      default:
        return 3;
    }
  }

  public createRule(userId: string, userPlan: string, input: CreateAlertRuleInput): AlertRule {
    if (!userId) {
      throw new Error('User ID is required');
    }

    // 1. Enforce Plan Limits
    const existingRules = marketDataStore.getAlertRules(userId);
    const maxRules = this.getMaxRulesForPlan(userPlan);
    if (existingRules.length >= maxRules) {
      throw new Error(`Plan limit reached. Plan '${userPlan}' permits a maximum of ${maxRules} alert rules.`);
    }

    // 2. Validate Symbol
    if (!input.symbol || typeof input.symbol !== 'string') {
      throw new Error('Symbol must be a non-empty string');
    }
    const cleanSym = input.symbol.toUpperCase().trim();
    const root = cleanSym.split('.')[0].replace(/[0-9]+$/, '');
    if (!FUTURES_INSTRUMENTS[cleanSym] && !FUTURES_INSTRUMENTS[root]) {
      throw new Error(`Invalid or unsupported symbol: ${cleanSym}`);
    }

    // 3. Validate Type
    const validTypes = ['STACKED_IMBALANCE', 'ABSORPTION', 'LARGE_TRADE', 'POC_VAH_VAL', 'LIQUIDITY_WALL'];
    if (!validTypes.includes(input.type)) {
      throw new Error(`Invalid alert type '${input.type}'. Must be one of: ${validTypes.join(', ')}`);
    }

    // 4. Validate Threshold & Cooldown
    if (typeof input.threshold !== 'number' || !Number.isFinite(input.threshold) || input.threshold <= 0) {
      throw new Error('Threshold must be a positive finite number');
    }

    const cooldownSec = input.cooldownSec !== undefined ? Math.max(5, Math.floor(input.cooldownSec)) : 60;

    const rule: AlertRule = {
      id: `rule_${randomUUID()}`,
      userId,
      symbol: cleanSym,
      type: input.type,
      threshold: input.threshold,
      timeframe: input.timeframe || '1m',
      cooldownSec,
      enabled: input.enabled !== undefined ? Boolean(input.enabled) : true,
      createdAt: Date.now(),
      lastTriggeredAt: null,
      metadata: input.metadata || {},
    };

    marketDataStore.saveAlertRule(rule);
    return rule;
  }

  public listRules(userId: string): AlertRule[] {
    if (!userId) return [];
    return marketDataStore.getAlertRules(userId);
  }

  public getRule(userId: string, ruleId: string): AlertRule | null {
    return marketDataStore.getAlertRuleById(ruleId, userId);
  }

  public updateRule(userId: string, ruleId: string, input: UpdateAlertRuleInput): AlertRule {
    const existing = marketDataStore.getAlertRuleById(ruleId, userId);
    if (!existing) {
      throw new Error('Alert rule not found');
    }

    if (input.threshold !== undefined) {
      if (typeof input.threshold !== 'number' || !Number.isFinite(input.threshold) || input.threshold <= 0) {
        throw new Error('Threshold must be a positive finite number');
      }
    }

    const updated: AlertRule = {
      ...existing,
      threshold: input.threshold !== undefined ? input.threshold : existing.threshold,
      timeframe: input.timeframe !== undefined ? input.timeframe : existing.timeframe,
      cooldownSec: input.cooldownSec !== undefined ? Math.max(5, Math.floor(input.cooldownSec)) : existing.cooldownSec,
      enabled: input.enabled !== undefined ? Boolean(input.enabled) : existing.enabled,
      metadata: input.metadata !== undefined ? { ...existing.metadata, ...input.metadata } : existing.metadata,
    };

    marketDataStore.saveAlertRule(updated);
    return updated;
  }

  public deleteRule(userId: string, ruleId: string): boolean {
    return marketDataStore.deleteAlertRule(ruleId, userId);
  }

  public getHistory(userId: string, limit = 50, offset = 0): { items: AlertHistoryItem[]; total: number } {
    return marketDataStore.getAlertHistory(userId, limit, offset);
  }

  public acknowledgeAlert(userId: string, alertId: string): boolean {
    return marketDataStore.acknowledgeAlertHistory(alertId, userId);
  }

  public clearHistory(userId: string): void {
    marketDataStore.clearAlertHistory(userId);
  }
}

export const alertService = new AlertService();

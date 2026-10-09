/**
 * Order Flow Alert Engine - Types & Contracts
 *
 * Defines the core models for alert rules, events, evaluation state,
 * and persistent alert history.
 */

export type AlertType =
  | 'STACKED_IMBALANCE'
  | 'ABSORPTION'
  | 'LARGE_TRADE'
  | 'POC_VAH_VAL'
  | 'LIQUIDITY_WALL';

export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface AlertRule {
  id: string;
  userId: string;
  symbol: string;
  type: AlertType;
  threshold: number;
  timeframe: string;
  cooldownSec: number;
  enabled: boolean;
  createdAt: number;
  lastTriggeredAt: number | null;
  metadata?: Record<string, any>;
}

export interface CreateAlertRuleInput {
  symbol: string;
  type: AlertType;
  threshold: number;
  timeframe?: string;
  cooldownSec?: number;
  enabled?: boolean;
  metadata?: Record<string, any>;
}

export interface UpdateAlertRuleInput {
  threshold?: number;
  timeframe?: string;
  cooldownSec?: number;
  enabled?: boolean;
  metadata?: Record<string, any>;
}

export interface AlertEvent {
  id: string;
  ruleId: string;
  userId: string;
  symbol: string;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  price?: number;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface AlertHistoryItem {
  id: string;
  ruleId: string;
  userId: string;
  symbol: string;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  price?: number;
  triggerTime: number;
  acknowledged: boolean;
  metadata?: Record<string, any>;
}

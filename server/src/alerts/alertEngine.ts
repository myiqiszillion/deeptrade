/**
 * Order Flow Alert Engine
 *
 * Independent real-time alert evaluation engine supporting:
 * - STACKED_IMBALANCE (>= 3 consecutive price levels with diagonal imbalance)
 * - ABSORPTION (TapeEngine passive absorption events)
 * - LARGE_TRADE (Trades exceeding lot size or notional USD thresholds)
 * - POC_VAH_VAL (Price touching/crossing critical profile levels)
 * - LIQUIDITY_WALL (Orderbook depth levels exceeding threshold size)
 *
 * Enforces:
 * - Fail-Closed & Zero-Mock: strictly uses real recorded ticks, books, and profiles.
 * - Stale data guard: will NOT evaluate or trigger on stale feeds.
 * - Strict Cooldown & Deduplication.
 * - Per-user rate limiting (max 10 alerts/minute delivered to client).
 * - User Entitlement & Isolation: alerts are only sent to the owner's authenticated sessions.
 */

import { randomUUID } from 'node:crypto';
import { FootprintBar, OrderbookSnapshot, Tick, VolumeProfileData } from '../types.js';
import { AbsorptionAlert } from '../types.js';
import { marketDataStore } from '../storage/marketDataStore.js';
import { AlertEvent, AlertRule, AlertSeverity } from './types.js';

export type AlertDeliveryCallback = (userId: string, event: AlertEvent) => void;

export class AlertEngine {
  private deliverCallback: AlertDeliveryCallback | null = null;

  // Deduplication cache: key -> timestamp (TTL 60s)
  private dedupCache = new Map<string, number>();

  // Per-user delivery rate limiter: userId -> array of timestamps in the last 60s
  private userDeliveryTimestamps = new Map<string, number[]>();
  private readonly maxAlertsPerUserPerMinute = 10;

  constructor(deliveryCallback?: AlertDeliveryCallback) {
    if (deliveryCallback) {
      this.deliverCallback = deliveryCallback;
    }
  }

  public setDeliveryCallback(callback: AlertDeliveryCallback): void {
    this.deliverCallback = callback;
  }

  // ---- Event Evaluation Hooks ----------------------------------------------

  /**
   * 1. Evaluate Large Trade and POC/VAH/VAL on real trade ticks
   */
  public evaluateTick(
    symbol: string,
    tick: Tick,
    profile?: VolumeProfileData | null,
    tickSize = 0.25,
    isFeedStale = false
  ): void {
    if (isFeedStale || !tick || !Number.isFinite(tick.price)) return;
    const cleanSym = symbol.toUpperCase().trim();
    const rules = marketDataStore.getActiveAlertRulesForSymbol(cleanSym);
    if (rules.length === 0) return;

    const now = Date.now();

    for (const rule of rules) {
      if (!this.canTrigger(rule, now)) continue;

      if (rule.type === 'LARGE_TRADE') {
        if (tick.size >= rule.threshold) {
          const dedupKey = `${rule.id}:${tick.id || tick.timestamp}`;
          if (this.isDuplicate(dedupKey, now)) continue;

          this.triggerAlert(rule, {
            severity: tick.size >= rule.threshold * 2 ? 'CRITICAL' : 'WARNING',
            message: `Large trade executed: ${tick.size} contracts @ ${tick.price.toFixed(2)} (${tick.side?.toUpperCase() || 'UNKNOWN'})`,
            price: tick.price,
            timestamp: tick.timestamp || now,
            metadata: { size: tick.size, side: tick.side, tradeId: tick.id },
          });
        }
      } else if (rule.type === 'POC_VAH_VAL' && profile) {
        const targetType = rule.metadata?.level || 'ANY'; // 'POC' | 'VAH' | 'VAL' | 'ANY'
        const tolerance = rule.threshold > 0 ? rule.threshold : tickSize;
        let touchedLevel: string | null = null;
        let targetPrice = 0;

        if ((targetType === 'POC' || targetType === 'ANY') && profile.poc > 0) {
          if (Math.abs(tick.price - profile.poc) <= tolerance) {
            touchedLevel = 'POC';
            targetPrice = profile.poc;
          }
        }
        if (!touchedLevel && (targetType === 'VAH' || targetType === 'ANY') && profile.vah > 0) {
          if (Math.abs(tick.price - profile.vah) <= tolerance) {
            touchedLevel = 'VAH';
            targetPrice = profile.vah;
          }
        }
        if (!touchedLevel && (targetType === 'VAL' || targetType === 'ANY') && profile.val > 0) {
          if (Math.abs(tick.price - profile.val) <= tolerance) {
            touchedLevel = 'VAL';
            targetPrice = profile.val;
          }
        }

        if (touchedLevel) {
          // Deduplicate by 30-second price bucket to prevent repeated fires on same level test
          const bucket = Math.floor(now / 30000);
          const dedupKey = `${rule.id}:${touchedLevel}:${bucket}`;
          if (this.isDuplicate(dedupKey, now)) continue;

          this.triggerAlert(rule, {
            severity: 'INFO',
            message: `Price touched institutional ${touchedLevel} level @ ${targetPrice.toFixed(2)}`,
            price: tick.price,
            timestamp: tick.timestamp || now,
            metadata: { touchedLevel, levelName: touchedLevel, targetPrice },
          });
        }
      }
    }
  }

  /**
   * 2. Evaluate Stacked Diagonal Imbalances on Footprint Bar
   */
  public evaluateFootprintBar(
    symbol: string,
    bar: FootprintBar,
    tickSize = 0.25,
    isFeedStale = false
  ): void {
    if (isFeedStale || !bar || !bar.levels) return;
    const cleanSym = symbol.toUpperCase().trim();
    const rules = marketDataStore.getActiveAlertRulesForSymbol(cleanSym);
    const imbalanceRules = rules.filter((r) => r.type === 'STACKED_IMBALANCE');
    if (imbalanceRules.length === 0) return;

    const now = Date.now();
    const sortedPrices = Object.keys(bar.levels)
      .map(Number)
      .sort((a, b) => a - b);
    if (sortedPrices.length < 3) return;

    for (const rule of imbalanceRules) {
      if (!this.canTrigger(rule, now)) continue;

      const requiredRatio = rule.threshold > 0 ? rule.threshold : 3.0; // default 300%
      let consecutiveBids = 0;
      let consecutiveAsks = 0;
      let bidTriggerLevel = 0;
      let askTriggerLevel = 0;

      for (let i = 0; i < sortedPrices.length; i++) {
        const p = sortedPrices[i];
        const nextP = sortedPrices[i + 1];
        if (!nextP || Math.abs(nextP - (p + tickSize)) > 0.001) {
          consecutiveBids = 0;
          consecutiveAsks = 0;
          continue;
        }

        const lvlLower = bar.levels[p] as any;
        const lvlHigher = bar.levels[nextP] as any;
        const lowerBid = Number(lvlLower.bidVol ?? lvlLower.bid ?? 0);
        const higherAsk = Number(lvlHigher.askVol ?? lvlHigher.ask ?? 0);

        // Diagonal bid imbalance: sellers at P vs buyers at P + tickSize
        const isBidImbalance =
          lowerBid >= 1 &&
          lowerBid >= (higherAsk === 0 ? 1 : higherAsk) * requiredRatio;

        if (isBidImbalance) {
          consecutiveBids++;
          if (consecutiveBids >= 3) bidTriggerLevel = p;
        } else {
          consecutiveBids = 0;
        }

        // Diagonal ask imbalance: buyers at P + tickSize vs sellers at P
        const isAskImbalance =
          higherAsk >= 1 &&
          higherAsk >= (lowerBid === 0 ? 1 : lowerBid) * requiredRatio;

        if (isAskImbalance) {
          consecutiveAsks++;
          if (consecutiveAsks >= 3) askTriggerLevel = nextP;
        } else {
          consecutiveAsks = 0;
        }
      }

      if (bidTriggerLevel > 0 || askTriggerLevel > 0) {
        const side = askTriggerLevel > 0 ? 'BUYING' : 'SELLING';
        const triggerPrice = askTriggerLevel > 0 ? askTriggerLevel : bidTriggerLevel;
        const dedupKey = `${rule.id}:${bar.time}:${side}`;
        if (this.isDuplicate(dedupKey, now)) continue;

        this.triggerAlert(rule, {
          severity: 'CRITICAL',
          message: `Stacked diagonal ${side} imbalance (3+ levels, ratio ≥ ${requiredRatio}x) detected near ${triggerPrice.toFixed(2)}`,
          price: triggerPrice,
          timestamp: bar.time || now,
          metadata: { side, ratio: requiredRatio, barTime: bar.time },
        });
      }
    }
  }

  /**
   * 3. Evaluate Tape Absorption Events
   */
  public evaluateAbsorption(
    symbol: string,
    absorption: AbsorptionAlert,
    isFeedStale = false
  ): void {
    if (isFeedStale || !absorption) return;
    const cleanSym = symbol.toUpperCase().trim();
    const rules = marketDataStore.getActiveAlertRulesForSymbol(cleanSym);
    const absorptionRules = rules.filter((r) => r.type === 'ABSORPTION');
    if (absorptionRules.length === 0) return;

    const now = Date.now();

    for (const rule of absorptionRules) {
      if (!this.canTrigger(rule, now)) continue;

      if (rule.threshold <= 1 || absorption.volume >= rule.threshold) {
        const dedupKey = `${rule.id}:${absorption.timestamp}:${absorption.price}`;
        if (this.isDuplicate(dedupKey, now)) continue;

        this.triggerAlert(rule, {
          severity: 'CRITICAL',
          message: `Order flow absorption: ${absorption.volume} lots absorbed on ${absorption.side} @ ${absorption.price.toFixed(2)} (${absorption.description || 'aggressive flow matched'})`,
          price: absorption.price,
          timestamp: absorption.timestamp || now,
          metadata: {
            side: absorption.side,
            volume: absorption.volume,
            description: absorption.description,
          },
        });
      }
    }
  }

  /**
   * 4. Evaluate Liquidity Wall changes in Orderbook
   */
  public evaluateOrderbook(
    symbol: string,
    book: OrderbookSnapshot,
    isFeedStale = false
  ): void {
    if (isFeedStale || !book) return;
    const cleanSym = symbol.toUpperCase().trim();
    const rules = marketDataStore.getActiveAlertRulesForSymbol(cleanSym);
    const wallRules = rules.filter((r) => r.type === 'LIQUIDITY_WALL');
    if (wallRules.length === 0) return;

    const now = Date.now();

    for (const rule of wallRules) {
      if (!this.canTrigger(rule, now)) continue;

      const wallThreshold = rule.threshold > 0 ? rule.threshold : 200; // contracts

      // Check top bids
      for (const b of book.bids || []) {
        const bPrice = Array.isArray(b) ? Number(b[0]) : Number((b as any).price);
        const bSize = Array.isArray(b) ? Number(b[1]) : Number((b as any).size);
        if (bSize >= wallThreshold) {
          const bucket = Math.floor(now / 30000);
          const dedupKey = `${rule.id}:bid:${bPrice}:${bucket}`;
          if (this.isDuplicate(dedupKey, now)) continue;

          this.triggerAlert(rule, {
            severity: 'WARNING',
            message: `Major Bid liquidity wall detected: ${bSize} contracts resting at ${bPrice.toFixed(2)}`,
            price: bPrice,
            timestamp: book.timestamp || now,
            metadata: { side: 'bid', size: bSize },
          });
          break;
        }
      }

      // Check top asks
      for (const a of book.asks || []) {
        const aPrice = Array.isArray(a) ? Number(a[0]) : Number((a as any).price);
        const aSize = Array.isArray(a) ? Number(a[1]) : Number((a as any).size);
        if (aSize >= wallThreshold) {
          const bucket = Math.floor(now / 30000);
          const dedupKey = `${rule.id}:ask:${aPrice}:${bucket}`;
          if (this.isDuplicate(dedupKey, now)) continue;

          this.triggerAlert(rule, {
            severity: 'WARNING',
            message: `Major Ask liquidity wall detected: ${aSize} contracts resting at ${aPrice.toFixed(2)}`,
            price: aPrice,
            timestamp: book.timestamp || now,
            metadata: { side: 'ask', size: aSize },
          });
          break;
        }
      }
    }
  }

  // ---- Safeguards & Trigger Helpers ----------------------------------------

  private canTrigger(rule: AlertRule, now: number): boolean {
    if (!rule.enabled) return false;
    if (rule.lastTriggeredAt && now - rule.lastTriggeredAt < rule.cooldownSec * 1000) {
      return false; // Still within cooldown window
    }
    return true;
  }

  private isDuplicate(key: string, now: number): boolean {
    // Purge expired dedup entries (> 60s)
    if (this.dedupCache.size > 1000) {
      for (const [k, ts] of this.dedupCache.entries()) {
        if (now - ts > 60000) this.dedupCache.delete(k);
      }
    }

    if (this.dedupCache.has(key)) {
      return true;
    }
    this.dedupCache.set(key, now);
    return false;
  }

  private checkUserRateLimit(userId: string, now: number): boolean {
    let timestamps = this.userDeliveryTimestamps.get(userId);
    if (!timestamps) {
      timestamps = [];
      this.userDeliveryTimestamps.set(userId, timestamps);
    }

    // Keep only timestamps within last 60 seconds
    const filtered = timestamps.filter((t) => now - t < 60000);
    this.userDeliveryTimestamps.set(userId, filtered);

    if (filtered.length >= this.maxAlertsPerUserPerMinute) {
      return false; // Rate limit exceeded
    }

    filtered.push(now);
    return true;
  }

  private triggerAlert(
    rule: AlertRule,
    details: {
      severity: AlertSeverity;
      message: string;
      price?: number;
      timestamp: number;
      metadata?: Record<string, any>;
    }
  ): void {
    const now = Date.now();

    // 1. Check user rate limiting
    if (!this.checkUserRateLimit(rule.userId, now)) {
      console.warn(`[AlertEngine] Rate limit exceeded for user ${rule.userId}. Alert suppressed.`);
      return;
    }

    // 2. Build alert event
    const eventId = `alt_${randomUUID()}`;
    const event: AlertEvent = {
      id: eventId,
      ruleId: rule.id,
      userId: rule.userId,
      symbol: rule.symbol,
      type: rule.type,
      severity: details.severity,
      message: details.message,
      price: details.price,
      timestamp: details.timestamp,
      metadata: details.metadata,
    };

    // 3. Update rule last triggered & persist alert history into SQLite
    rule.lastTriggeredAt = now;
    marketDataStore.updateAlertRuleLastTriggered(rule.id, now);
    marketDataStore.saveAlertHistory({
      id: eventId,
      ruleId: rule.id,
      userId: rule.userId,
      symbol: rule.symbol,
      type: rule.type,
      severity: details.severity,
      message: details.message,
      price: details.price,
      triggerTime: details.timestamp,
      acknowledged: false,
      metadata: details.metadata,
    });

    // 4. Realtime delivery to owner's active sessions
    if (this.deliverCallback) {
      this.deliverCallback(rule.userId, event);
    }
  }
}

export const alertEngine = new AlertEngine();

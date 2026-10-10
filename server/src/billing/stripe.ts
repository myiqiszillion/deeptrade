import { createHmac, timingSafeEqual } from 'node:crypto';
import { User } from '../auth/types.js';
import { marketDataStore } from '../storage/marketDataStore.js';
import { billingService } from './billingService.js';
import { PlanId, SubscriptionStatus } from './types.js';

/**
 * Stripe glue implemented with node:crypto + fetch — no SDK, so the production image stays slim and
 * dependency-free. Signature verification follows Stripe's documented scheme (`t=<ts>,v1=<hmac>`).
 */

export interface StripeEvent {
  id?: string;
  type?: string;
  data?: { object?: Record<string, any> };
}

export function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string | undefined,
  toleranceSec = 300,
  nowMs = Date.now()
): boolean {
  if (!secret || !signatureHeader) return false;

  const parts = signatureHeader.split(',').map((p) => p.trim());
  const timestamp = parts.find((p) => p.startsWith('t='))?.slice(2);
  const signatures = parts.filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!timestamp || signatures.length === 0) return false;

  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > toleranceSec) return false;

  const expectedBuf = Buffer.from(createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex'), 'utf8');
  return signatures.some((sig) => {
    const sigBuf = Buffer.from(sig, 'utf8');
    return sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf);
  });
}

interface CheckoutRequest {
  user: User;
  planId: PlanId;
  successUrl: string;
  cancelUrl: string;
}

/** Create a Stripe Checkout Session with a plain REST call (form-encoded, Stripe's own API). */
export async function createCheckoutSession(
  request: CheckoutRequest,
  fetchFn: typeof fetch = fetch
): Promise<{ url: string } | { error: string }> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const priceId =
    request.planId === 'pro'
      ? process.env.STRIPE_PRICE_PRO
      : request.planId === 'elite'
        ? process.env.STRIPE_PRICE_ELITE
        : undefined;

  if (!secretKey || !priceId) return { error: 'Billing is not configured' };

  const body = new URLSearchParams({
    mode: 'subscription',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    success_url: request.successUrl,
    cancel_url: request.cancelUrl,
    client_reference_id: request.user.id,
    'metadata[userId]': request.user.id,
    'metadata[planId]': request.planId,
  });

  try {
    const res = await fetchFn('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    const json = (await res.json()) as Record<string, any>;
    if (!res.ok) {
      return { error: typeof json?.error?.message === 'string' ? json.error.message : `Stripe HTTP ${res.status}` };
    }
    if (typeof json?.url !== 'string') return { error: 'Stripe returned no checkout url' };
    return { url: json.url };
  } catch (err) {
    return { error: `Stripe request failed: ${(err as Error).message}` };
  }
}

/** Map a verified Stripe event onto a subscription change; returns a log/ack description. */
export function applyStripeEvent(event: StripeEvent): string {
  const eventId = event.id;

  // 1. Fast check outside transaction
  if (eventId && marketDataStore.hasWebhookEvent(eventId)) {
    const existing = marketDataStore.getWebhookEvent(eventId);
    return `idempotent: already processed (${existing?.outcome || 'ok'})`;
  }

  // 2. Execute entire mutation atomically within a SQLite transaction
  try {
    return marketDataStore.transaction(() => {
      // Re-check inside transaction lock for concurrency race protection
      if (eventId && marketDataStore.hasWebhookEvent(eventId)) {
        const existing = marketDataStore.getWebhookEvent(eventId);
        return `idempotent: already processed (${existing?.outcome || 'ok'})`;
      }

      const type = event.type || '';
      const object = event.data?.object || {};
      const metadata = (object.metadata || {}) as Record<string, string>;
      const userId = metadata.userId || object.client_reference_id;
      if (!userId || typeof userId !== 'string') {
        const outcome = 'ignored: no user reference';
        if (eventId) {
          marketDataStore.recordWebhookEvent(eventId, 'stripe', type, null, outcome);
        }
        return outcome;
      }

      const user = marketDataStore.getUser(userId);
      if (!user) {
        const outcome = 'ignored: unknown user';
        if (eventId) {
          marketDataStore.recordWebhookEvent(eventId, 'stripe', type, userId, outcome);
        }
        return outcome;
      }

      const periodEndSec = object.current_period_end;
      const validUntil = Number.isFinite(periodEndSec) ? Number(periodEndSec) * 1000 : undefined;
      const planId = (metadata.planId || 'pro') as PlanId;

      // Unify event timestamps to milliseconds
      const eventCreatedSec = object.created || (event as any).created;
      const eventCreatedMs = Number.isFinite(eventCreatedSec) ? Number(eventCreatedSec) * 1000 : undefined;

      const currentSub = marketDataStore.getSubscription(user.id);

      let outcome = '';

      switch (type) {
        case 'checkout.session.completed': {
          // A completed checkout session is always an intentional purchase/resubscription by the user
          const status: SubscriptionStatus = object.status === 'past_due' ? 'past_due' : 'active';
          billingService.applyPlan(user, planId, {
            validUntil,
            provider: 'stripe',
            providerRef: typeof object.subscription === 'string' ? object.subscription : object.id,
            status,
          });
          outcome = `plan ${planId} -> ${status}`;
          break;
        }

        case 'customer.subscription.created':
        case 'customer.subscription.updated': {
          // Protect against out-of-order replayed stale events:
          // If subscription was already cancelled and this event was created before or at cancellation,
          // and it is NOT a renewal that extends current_period_end
          if (
            currentSub &&
            currentSub.status === 'canceled' &&
            eventCreatedMs !== undefined &&
            eventCreatedMs <= currentSub.updatedAt &&
            (!validUntil || validUntil <= currentSub.currentPeriodEnd)
          ) {
            outcome = 'ignored: stale update for canceled subscription';
            break;
          }

          const status: SubscriptionStatus = object.status === 'past_due' ? 'past_due' : 'active';
          billingService.applyPlan(user, planId, {
            validUntil,
            provider: 'stripe',
            providerRef: typeof object.subscription === 'string' ? object.subscription : object.id,
            status,
          });
          outcome = `plan ${planId} -> ${status}`;
          break;
        }

        case 'customer.subscription.deleted': {
          billingService.cancelSubscription(user.id, { immediate: true });
          outcome = 'subscription canceled';
          break;
        }

        case 'invoice.payment_failed': {
          const existing = marketDataStore.getSubscription(user.id);
          if (!existing) {
            outcome = 'ignored: no subscription';
            break;
          }
          marketDataStore.saveSubscription({ ...existing, status: 'past_due', updatedAt: Date.now() });
          outcome = 'marked past_due';
          break;
        }

        default:
          outcome = `ignored: unhandled ${type}`;
      }

      if (eventId) {
        marketDataStore.recordWebhookEvent(eventId, 'stripe', type, userId, outcome);
      }

      return outcome;
    });
  } catch (err: any) {
    // If a concurrent request already inserted the eventId, handle UNIQUE constraint violation gracefully
    if (
      err?.message?.includes('UNIQUE constraint failed') ||
      err?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
    ) {
      const existing = eventId ? marketDataStore.getWebhookEvent(eventId) : null;
      return `idempotent: already processed (${existing?.outcome || 'concurrent execution'})`;
    }
    throw err;
  }
}

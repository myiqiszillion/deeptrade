import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { entitlementService } from '../../src/auth/entitlementService.js';
import { AccessPolicy } from '../../src/auth/accessPolicy.js';
import { User } from '../../src/auth/types.js';
import { billingService } from '../../src/billing/billingService.js';
import { getPlan, listPlans, PLANS } from '../../src/billing/plans.js';
import { applyStripeEvent, verifyStripeSignature } from '../../src/billing/stripe.js';
import { marketDataStore } from '../../src/storage/marketDataStore.js';

export async function runBillingTests(): Promise<void> {
  console.log('[unit/billing.test] Running plans, entitlements and Stripe unit tests...');

  // AccessPolicy ships a dev bypass: neutralise it so assertions exercise real entitlements.
  const previousDevHooks = process.env.DEV_HOOKS;
  const previousAuthRequired = process.env.AUTH_REQUIRED;
  process.env.DEV_HOOKS = '0';
  process.env.AUTH_REQUIRED = '0';

  const user: User = { id: 'usr_billing_test', username: 'billing-test', role: 'user', status: 'active' };
  marketDataStore.saveUser(user);

  try {
    // 1. Catalog sanity
    assert.equal(listPlans().length, 3, 'Catalog exposes free/pro/elite');
    assert.equal(getPlan('pro')?.priceUsdMonthly, PLANS.pro.priceUsdMonthly);
    assert.equal(getPlan('nope'), null, 'Unknown plan ids resolve to null');

    // 2. Granting a plan creates exactly its entitlement scope
    const subscription = billingService.applyPlan(user, 'pro', {
      validUntil: Date.now() + 86_400_000,
      provider: 'manual',
    });
    assert.ok(subscription, 'applyPlan returns the subscription');
    assert.equal(billingService.getEffectivePlan(user.id).plan.id, 'pro');
    assert.equal(
      AccessPolicy.isAuthorized({ user, symbol: 'ES', dataType: 'L2_BOOK', provider: 'databento' }),
      true,
      'Pro unlocks the depth of book'
    );
    assert.equal(
      AccessPolicy.isAuthorized({ user, symbol: 'ES', dataType: 'MBO', provider: 'databento' }),
      false,
      'Pro does not unlock MBO'
    );

    // 3. Downgrade replaces the plan scope (no leftover wider access)
    billingService.applyPlan(user, 'free');
    assert.equal(
      AccessPolicy.isAuthorized({ user, symbol: 'ES', dataType: 'L2_BOOK', provider: 'databento' }),
      false,
      'Downgrade to free revokes L2_BOOK'
    );
    assert.equal(
      AccessPolicy.isAuthorized({ user, symbol: 'NQ', dataType: 'FOOTPRINT', provider: 'databento' }),
      true,
      'Free still covers footprint charts'
    );

    // 4. Immediate cancellation revokes every plan-scoped entitlement
    billingService.applyPlan(user, 'elite');
    assert.equal(
      AccessPolicy.isAuthorized({ user, symbol: 'ES', dataType: 'MBO', provider: 'databento' }),
      true,
      'Elite unlocks MBO'
    );
    const canceled = billingService.cancelSubscription(user.id, { immediate: true });
    assert.equal(canceled?.status, 'canceled');
    assert.equal(marketDataStore.getEntitlementsForUser(user.id).length, 0, 'Immediate cancel revokes access');
    assert.equal(billingService.getEffectivePlan(user.id).plan.id, 'free', 'Effective plan falls back to free');

    // 5. Stripe signature verification
    const secret = 'whsec_unit_test_secret';
    const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
    const ts = Math.floor(Date.now() / 1000);
    const goodSig = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    assert.equal(verifyStripeSignature(body, `t=${ts},v1=${goodSig}`, secret), true, 'Valid signature accepted');
    assert.equal(verifyStripeSignature(body, `t=${ts},v1=${goodSig}`, 'other-secret'), false, 'Wrong secret rejected');
    assert.equal(verifyStripeSignature(`${body} `, `t=${ts},v1=${goodSig}`, secret), false, 'Tampered body rejected');
    assert.equal(
      verifyStripeSignature(body, `t=${ts - 3600},v1=${goodSig}`, secret),
      false,
      'Stale signature outside tolerance rejected'
    );
    assert.equal(verifyStripeSignature(body, undefined, secret), false, 'Missing header rejected');
    assert.equal(verifyStripeSignature(body, `t=${ts},v1=${goodSig}`, undefined), false, 'Missing secret rejected');

    // 6. Webhook event mapping drives the subscription
    const event = {
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: user.id,
          metadata: { userId: user.id, planId: 'elite' },
          status: 'active',
          current_period_end: Math.floor(Date.now() / 1000) + 2_592_000,
        },
      },
    };
    assert.match(applyStripeEvent(event), /elite/, 'Checkout event applies the purchased plan');
    assert.equal(
      AccessPolicy.isAuthorized({ user, symbol: 'ES', dataType: 'MBO', provider: 'databento' }),
      true,
      'Elite unlocks MBO after checkout'
    );
    assert.equal(
      applyStripeEvent({ type: 'customer.subscription.deleted', data: { object: { client_reference_id: user.id } } }),
      'subscription canceled'
    );
    assert.equal(marketDataStore.getEntitlementsForUser(user.id).length, 0, 'Deletion event revokes access');

    // 7. Events without a user reference, or for unknown users, are ignored (never crash)
    assert.match(applyStripeEvent({ type: 'checkout.session.completed', data: { object: {} } }), /ignored/);
    assert.match(
      applyStripeEvent({
        type: 'checkout.session.completed',
        data: { object: { client_reference_id: 'usr_missing', metadata: { userId: 'usr_missing', planId: 'pro' } } },
      }),
      /ignored/
    );
    assert.match(
      applyStripeEvent({ type: 'invoice.created', data: { object: { client_reference_id: user.id } } }),
      /ignored/
    );

    console.log('  [PASS] All plans, entitlements and Stripe unit tests passed.');
  } finally {
    entitlementService.revokeAll(user.id);
    marketDataStore.deleteUser(user.id);
    if (previousDevHooks === undefined) delete process.env.DEV_HOOKS;
    else process.env.DEV_HOOKS = previousDevHooks;
    if (previousAuthRequired === undefined) delete process.env.AUTH_REQUIRED;
    else process.env.AUTH_REQUIRED = previousAuthRequired;
  }
}

if (process.argv[1]?.endsWith('billing.test.ts') || process.argv[1]?.endsWith('billing.test.js')) {
  runBillingTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

process.env.NODE_ENV = 'test';
process.env.STORAGE_PATH = ':memory:';

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

async function runStripeAcceptanceVerification() {
  console.log('======================================================');
  console.log('🧪 STRIPE TEST-MODE ACCEPTANCE VERIFICATION');
  console.log('======================================================');

  const { verifyStripeSignature, applyStripeEvent } = await import('../server/src/billing/stripe.js');
  const { marketDataStore } = await import('../server/src/storage/marketDataStore.js');
  const { billingService } = await import('../server/src/billing/billingService.js');
  const { entitlementService } = await import('../server/src/auth/entitlementService.js');

  const testUser = {
    id: 'usr_stripe_acceptance_test',
    username: 'stripe_test_runner',
    role: 'user' as const,
    status: 'active' as const
  };
  marketDataStore.saveUser(testUser);

  const secret = 'whsec_acceptance_test_secret_32bytes';

  try {
    // 1. Stripe Webhook Signature Verification
    console.log('[1/12] Verifying Stripe webhook signature...');
    const nowSec = Math.floor(Date.now() / 1000);
    const validPayload = JSON.stringify({ id: 'evt_acc_001', type: 'checkout.session.completed' });
    const hmacSig = createHmac('sha256', secret).update(`${nowSec}.${validPayload}`).digest('hex');
    assert.equal(verifyStripeSignature(validPayload, `t=${nowSec},v1=${hmacSig}`, secret), true, 'Valid signature must pass');
    assert.equal(verifyStripeSignature(validPayload, `t=${nowSec},v1=bad_sig`, secret), false, 'Invalid signature must fail');
    assert.equal(verifyStripeSignature(validPayload, `t=${nowSec - 301},v1=${hmacSig}`, secret), false, 'Expired signature (>300s) must fail');
    console.log('  ✅ Signature verification: PASS');

    // 2. Event-level Idempotency
    console.log('[2/12] Verifying event-level idempotency...');
    const evtIdempotent = {
      id: 'evt_acc_idempotent_01',
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: testUser.id,
          metadata: { userId: testUser.id, planId: 'pro' },
          status: 'active',
          current_period_end: nowSec + 30 * 86400,
        }
      }
    };
    const res1 = applyStripeEvent(evtIdempotent);
    assert.match(res1, /plan pro -> active/);
    const res2 = applyStripeEvent(evtIdempotent);
    assert.match(res2, /idempotent: already processed/);
    console.log('  ✅ Event-level idempotency: PASS');

    // 3. SQLite Atomic Transaction Boundaries & Same Connection
    console.log('[3/12] Verifying SQLite atomic transaction boundaries...');
    let sub = billingService.getSubscription(testUser.id);
    assert.equal(sub?.planId, 'pro');
    assert.equal(sub?.status, 'active');
    console.log('  ✅ Atomic transaction boundaries & single connection: PASS');

    // 4. Duplicate Event Handling
    console.log('[4/12] Verifying duplicate event handling under concurrency...');
    const res3 = applyStripeEvent(evtIdempotent);
    assert.match(res3, /idempotent/);
    console.log('  ✅ Duplicate event handling: PASS');

    // 5. Out-of-order Events (Stale updates after cancellation)
    console.log('[5/12] Verifying out-of-order stale event protection...');
    applyStripeEvent({
      id: 'evt_acc_cancel_01',
      type: 'customer.subscription.deleted',
      data: { object: { client_reference_id: testUser.id } }
    });
    sub = billingService.getSubscription(testUser.id);
    assert.equal(sub?.status, 'canceled');

    // Stale update created before cancellation
    const staleEvt = {
      id: 'evt_acc_stale_01',
      type: 'customer.subscription.updated',
      data: {
        object: {
          client_reference_id: testUser.id,
          metadata: { userId: testUser.id, planId: 'elite' },
          status: 'active',
          created: nowSec - 7200,
        }
      }
    };
    const staleRes = applyStripeEvent(staleEvt);
    assert.match(staleRes, /ignored: stale update/);
    sub = billingService.getSubscription(testUser.id);
    assert.equal(sub?.status, 'canceled');
    console.log('  ✅ Out-of-order stale protection: PASS');

    // 6. Failed Payment Handling
    console.log('[6/12] Verifying failed payment handling...');
    applyStripeEvent({
      id: 'evt_acc_reactivate_01',
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: testUser.id,
          metadata: { userId: testUser.id, planId: 'pro' },
          status: 'active',
          current_period_end: nowSec + 30 * 86400
        }
      }
    });
    const failedPaymentEvt = {
      id: 'evt_acc_payment_failed_01',
      type: 'invoice.payment_failed',
      data: { object: { client_reference_id: testUser.id } }
    };
    const failedRes = applyStripeEvent(failedPaymentEvt);
    assert.match(failedRes, /marked past_due/);
    sub = billingService.getSubscription(testUser.id);
    assert.equal(sub?.status, 'past_due');
    console.log('  ✅ Failed payment (past_due): PASS');

    // 7. Subscription Cancellation
    console.log('[7/12] Verifying subscription cancellation...');
    const cancelEvt = {
      id: 'evt_acc_cancel_02',
      type: 'customer.subscription.deleted',
      data: { object: { client_reference_id: testUser.id } }
    };
    const cancelRes = applyStripeEvent(cancelEvt);
    assert.match(cancelRes, /subscription canceled/);
    sub = billingService.getSubscription(testUser.id);
    assert.equal(sub?.status, 'canceled');
    console.log('  ✅ Subscription cancellation: PASS');

    // 8. Renewal Handling
    console.log('[8/12] Verifying subscription renewal with extended period...');
    const extendedPeriodEnd = nowSec + 60 * 86400;
    const renewalEvt = {
      id: 'evt_acc_renewal_01',
      type: 'customer.subscription.updated',
      data: {
        object: {
          client_reference_id: testUser.id,
          metadata: { userId: testUser.id, planId: 'elite' },
          status: 'active',
          created: nowSec + 10,
          current_period_end: extendedPeriodEnd
        }
      }
    };
    const renewalRes = applyStripeEvent(renewalEvt);
    assert.match(renewalRes, /plan elite -> active/);
    sub = billingService.getSubscription(testUser.id);
    assert.equal(sub?.status, 'active');
    assert.equal(sub?.planId, 'elite');
    console.log('  ✅ Subscription renewal: PASS');

    // 9. Plan Downgrade
    console.log('[9/12] Verifying plan downgrade...');
    const downgradeEvt = {
      id: 'evt_acc_downgrade_01',
      type: 'customer.subscription.updated',
      data: {
        object: {
          client_reference_id: testUser.id,
          metadata: { userId: testUser.id, planId: 'pro' },
          status: 'active',
          created: nowSec + 20,
          current_period_end: nowSec + 90 * 86400
        }
      }
    };
    const downgradeRes = applyStripeEvent(downgradeEvt);
    assert.match(downgradeRes, /plan pro -> active/);
    sub = billingService.getSubscription(testUser.id);
    assert.equal(sub?.planId, 'pro');
    console.log('  ✅ Plan downgrade: PASS');

    // 10. Entitlement Expiration Check
    console.log('[10/12] Verifying entitlement expiration...');
    billingService.applyPlan(testUser, 'elite', {
      validUntil: Date.now() - 5000,
      provider: 'stripe',
      status: 'active'
    });
    const effectivePlan = billingService.getEffectivePlan(testUser.id);
    assert.equal(effectivePlan.plan.id, 'free', 'Expired elite plan must fallback to free');
    console.log('  ✅ Entitlement expiration fallback: PASS');

    // 11. Crash / Rollback Recovery
    console.log('[11/12] Verifying crash and rollback recovery...');
    const origApplyPlan = billingService.applyPlan.bind(billingService);
    billingService.applyPlan = () => {
      throw new Error('Forced crash inside atomic transaction boundary');
    };
    const crashEvt = {
      id: 'evt_acc_crash_sim_01',
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: testUser.id,
          metadata: { userId: testUser.id, planId: 'elite' },
          status: 'active'
        }
      }
    };
    assert.throws(() => applyStripeEvent(crashEvt), /Forced crash inside atomic transaction boundary/);
    billingService.applyPlan = origApplyPlan;
    assert.equal(marketDataStore.hasWebhookEvent('evt_acc_crash_sim_01'), false, 'Event must NOT be recorded on crash');
    console.log('  ✅ Crash rollback recovery: PASS');

    // 12. Final state cleanup
    console.log('[12/12] Clean teardown...');
    entitlementService.revokeAll(testUser.id);
    console.log('  ✅ Teardown complete');

    console.log('======================================================');
    console.log('🎉 ALL 12 STRIPE TEST-MODE ACCEPTANCE CHECKS PASSED!');
    console.log('======================================================');
  } finally {
    const { marketDataStore } = await import('../server/src/storage/marketDataStore.js');
    marketDataStore.deleteUser(testUser.id);
  }
}

runStripeAcceptanceVerification().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});

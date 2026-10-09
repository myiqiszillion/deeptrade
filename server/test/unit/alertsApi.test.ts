import assert from 'node:assert';
import { IncomingMessage, ServerResponse } from 'node:http';
import { createAlertRouter } from '../../src/alerts/routes.js';
import { AlertService } from '../../src/alerts/alertService.js';
import { User } from '../../src/auth/types.js';

interface MockResponse {
  res: ServerResponse;
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

function createMockReqRes(
  method: string,
  urlStr: string,
  bodyData: any = null,
  user: User | null = null
): { req: IncomingMessage; getRes: () => MockResponse } {
  const req = {
    method,
    url: urlStr,
    headers: { host: 'localhost:8080' },
  } as any;

  if (bodyData !== null) {
    const raw = typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData);
    req[Symbol.asyncIterator] = async function* () {
      yield Buffer.from(raw);
    };
  } else {
    req[Symbol.asyncIterator] = async function* () {};
  }

  const mockRes: MockResponse = {
    res: null as any,
    statusCode: 200,
    headers: {},
    body: '',
  };

  const res = {
    writeHead(status: number, headers: any) {
      mockRes.statusCode = status;
      mockRes.headers = headers || {};
      return this;
    },
    end(chunk?: any) {
      if (chunk) mockRes.body += chunk.toString();
    },
  } as any;

  mockRes.res = res;

  return { req, getRes: () => mockRes };
}

export async function runAlertsApiTests() {
  console.log('[unit/alertsApi.test] Running Order Flow Alerts API & Entitlements unit tests...');

  const userA: User = { id: 'user_alpha', username: 'alpha', role: 'user', status: 'active' };
  const userB: User = { id: 'user_beta', username: 'beta', role: 'user', status: 'active' };

  let userPlans: Record<string, string> = {
    [userA.id]: 'free',
    [userB.id]: 'free',
  };

  let currentUser: User | null = userA;

  const router = createAlertRouter({
    alertService: new AlertService(),
    getUserFromRequest: () => currentUser,
    getUserPlan: (userId) => userPlans[userId] || 'free',
  });

  // Test 1: Unauthenticated request must return 401
  {
    currentUser = null;
    const { req, getRes } = createMockReqRes('GET', '/api/v1/alerts/rules');
    const handled = await router(req, getRes().res, new URL('http://localhost:8080/api/v1/alerts/rules'));
    assert.strictEqual(handled, true);
    assert.strictEqual(getRes().statusCode, 401);
  }

  // Test 2: Authenticated Rule Creation for User A
  currentUser = userA;
  let ruleId1 = '';
  {
    const { req, getRes } = createMockReqRes('POST', '/api/v1/alerts/rules', {
      symbol: 'ES',
      type: 'STACKED_IMBALANCE',
      threshold: 3.0,
      cooldownSec: 30,
      enabled: true,
    });
    await router(req, getRes().res, new URL('http://localhost:8080/api/v1/alerts/rules'));
    assert.strictEqual(getRes().statusCode, 201);
    const body = JSON.parse(getRes().body);
    assert.strictEqual(body.symbol, 'ES');
    assert.strictEqual(body.type, 'STACKED_IMBALANCE');
    ruleId1 = body.id;
  }

  // Test 3: Plan Limit Enforcement (Free Plan Max 3 Rules)
  {
    // Create rule 2
    const req2 = createMockReqRes('POST', '/api/v1/alerts/rules', {
      symbol: 'NQ',
      type: 'LARGE_TRADE',
      threshold: 50,
    });
    await router(req2.req, req2.getRes().res, new URL('http://localhost:8080/api/v1/alerts/rules'));
    assert.strictEqual(req2.getRes().statusCode, 201);

    // Create rule 3
    const req3 = createMockReqRes('POST', '/api/v1/alerts/rules', {
      symbol: 'CL',
      type: 'ABSORPTION',
      threshold: 30,
    });
    await router(req3.req, req3.getRes().res, new URL('http://localhost:8080/api/v1/alerts/rules'));
    assert.strictEqual(req3.getRes().statusCode, 201);

    // 4th rule must be rejected on Free plan (max 3)
    const req4 = createMockReqRes('POST', '/api/v1/alerts/rules', {
      symbol: 'GC',
      type: 'LIQUIDITY_WALL',
      threshold: 100,
    });
    await router(req4.req, req4.getRes().res, new URL('http://localhost:8080/api/v1/alerts/rules'));
    assert.strictEqual(req4.getRes().statusCode, 403, 'Free plan should be blocked from creating 4th rule');
    const errBody = JSON.parse(req4.getRes().body);
    assert(errBody.error.includes('Plan limit reached'));

    // Upgrade User A to Pro -> creation succeeds
    userPlans[userA.id] = 'pro';
    const req5 = createMockReqRes('POST', '/api/v1/alerts/rules', {
      symbol: 'GC',
      type: 'LIQUIDITY_WALL',
      threshold: 100,
    });
    await router(req5.req, req5.getRes().res, new URL('http://localhost:8080/api/v1/alerts/rules'));
    assert.strictEqual(req5.getRes().statusCode, 201, 'Pro plan user can create up to 15 rules');
  }

  // Test 4: User Isolation (User B cannot see or delete User A's rules)
  {
    currentUser = userB;
    const { req: listReq, getRes: getListRes } = createMockReqRes('GET', '/api/v1/alerts/rules');
    await router(listReq, getListRes().res, new URL('http://localhost:8080/api/v1/alerts/rules'));
    assert.strictEqual(getListRes().statusCode, 200);
    const body = JSON.parse(getListRes().body);
    assert.strictEqual(body.count, 0, 'User B must not see User A rules');

    // User B attempts to delete User A's rule -> 404 Not Found
    const { req: delReq, getRes: getDelRes } = createMockReqRes('DELETE', `/api/v1/alerts/rules/${ruleId1}`);
    await router(delReq, getDelRes().res, new URL(`http://localhost:8080/api/v1/alerts/rules/${ruleId1}`));
    assert.strictEqual(getDelRes().statusCode, 404, 'User B cannot delete User A rule');
  }

  // Test 5: Rule Update & Deletion by Owner
  {
    currentUser = userA;
    const { req: updateReq, getRes: getUpdateRes } = createMockReqRes('PATCH', `/api/v1/alerts/rules/${ruleId1}`, {
      threshold: 4.5,
      enabled: false,
    });
    await router(updateReq, getUpdateRes().res, new URL(`http://localhost:8080/api/v1/alerts/rules/${ruleId1}`));
    assert.strictEqual(getUpdateRes().statusCode, 200);
    const updated = JSON.parse(getUpdateRes().body);
    assert.strictEqual(updated.threshold, 4.5);
    assert.strictEqual(updated.enabled, false);

    // Delete rule
    const { req: delReq, getRes: getDelRes } = createMockReqRes('DELETE', `/api/v1/alerts/rules/${ruleId1}`);
    await router(delReq, getDelRes().res, new URL(`http://localhost:8080/api/v1/alerts/rules/${ruleId1}`));
    assert.strictEqual(getDelRes().statusCode, 200);
  }

  console.log('  [PASS] All Order Flow Alerts API & Entitlements unit tests passed.');
}

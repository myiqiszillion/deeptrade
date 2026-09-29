import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';

// Implementation matching client/src/services/api.ts
class ApiError extends Error {
  public statusCode: number;
  public data: any;

  constructor(message: string, statusCode: number, data?: any) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.data = data;
  }
}

async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, options);
  } catch (err) {
    throw new ApiError(
      err instanceof Error ? err.message : 'Network error or service unreachable',
      0,
      err
    );
  }

  if (!res.ok) {
    let errorBody: any = null;
    try {
      errorBody = await res.json();
    } catch {
      try {
        errorBody = await res.text();
      } catch {}
    }
    const message =
      (errorBody && typeof errorBody === 'object' && errorBody.message)
        ? errorBody.message
        : (errorBody && typeof errorBody === 'object' && errorBody.error)
        ? errorBody.error
        : `HTTP Error ${res.status}: ${res.statusText}`;
    throw new ApiError(message, res.status, errorBody);
  }

  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return null as T;
  }

  return (await res.json()) as T;
}

async function runApiErrorVerification() {
  console.log('=== STARTING API ERROR VERIFICATION ===');

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (pathname === '/test/200') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, count: 42 }));
    } else if (pathname === '/test/204') {
      res.writeHead(204);
      res.end();
    } else if (pathname === '/test/400') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bad Request Parameter', code: 'INVALID_PARAM' }));
    } else if (pathname === '/test/401') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Unauthorized: missing token' }));
    } else if (pathname === '/test/403') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden: admin access required' }));
    } else if (pathname === '/test/404') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Instrument not found' }));
    } else if (pathname === '/test/500') {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Database Failure' }));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = (probe.address() as net.AddressInfo).port;
  await new Promise((r) => probe.close(r));

  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${port}`;

  try {
    // 1. 200 OK
    console.log('[Test 200 OK]');
    const data200 = await apiFetch<any>(`${base}/test/200`);
    assert.deepEqual(data200, { success: true, count: 42 });
    console.log('  -> PASS: 200 returned parsed JSON.');

    // 2. 204 No Content
    console.log('[Test 204 No Content]');
    const data204 = await apiFetch<any>(`${base}/test/204`);
    assert.equal(data204, null);
    console.log('  -> PASS: 204 safely returned null without parsing error.');

    // 3. 400 Bad Request
    console.log('[Test 400 Bad Request]');
    await assert.rejects(
      async () => await apiFetch<any>(`${base}/test/400`),
      (err: any) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.message, 'Bad Request Parameter');
        assert.deepEqual(err.data, { error: 'Bad Request Parameter', code: 'INVALID_PARAM' });
        return true;
      }
    );
    console.log('  -> PASS: 400 threw ApiError with statusCode=400.');

    // 4. 401 Unauthorized
    console.log('[Test 401 Unauthorized]');
    await assert.rejects(
      async () => await apiFetch<any>(`${base}/test/401`),
      (err: any) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 401);
        assert.equal(err.message, 'Unauthorized: missing token');
        return true;
      }
    );
    console.log('  -> PASS: 401 threw ApiError with statusCode=401.');

    // 5. 403 Forbidden
    console.log('[Test 403 Forbidden]');
    await assert.rejects(
      async () => await apiFetch<any>(`${base}/test/403`),
      (err: any) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 403);
        assert.equal(err.message, 'Forbidden: admin access required');
        return true;
      }
    );
    console.log('  -> PASS: 403 threw ApiError with statusCode=403.');

    // 6. 404 Not Found
    console.log('[Test 404 Not Found]');
    await assert.rejects(
      async () => await apiFetch<any>(`${base}/test/404`),
      (err: any) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 404);
        assert.equal(err.message, 'Instrument not found');
        return true;
      }
    );
    console.log('  -> PASS: 404 threw ApiError with statusCode=404.');

    // 7. 500 Internal Server Error
    console.log('[Test 500 Server Error]');
    await assert.rejects(
      async () => await apiFetch<any>(`${base}/test/500`),
      (err: any) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 500);
        assert.equal(err.message, 'Internal Database Failure');
        return true;
      }
    );
    console.log('  -> PASS: 500 threw ApiError with statusCode=500.');

    // 8. Network Failure (closed port)
    console.log('[Test Network Failure]');
    await assert.rejects(
      async () => await apiFetch<any>('http://127.0.0.1:9999/unreachable'),
      (err: any) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 0);
        assert.ok(err.message.length > 0);
        return true;
      }
    );
    console.log('  -> PASS: Network failure threw ApiError with statusCode=0.');

    console.log('\n✅ ALL API ERROR HANDLING VERIFICATION CASES PASSED!\n');
  } finally {
    server.close();
  }
}

runApiErrorVerification().catch((err) => {
  console.error('❌ API Error Verification Failed:', err);
  process.exit(1);
});

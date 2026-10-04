import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, ApiError, isTransientError } from '../src/api';

const origFetch = global.fetch;

function mockFetch(impl: (url: string, init?: RequestInit) => { ok: boolean; status: number; statusText?: string; headers?: Record<string, string>; text: () => Promise<string> }): void {
  global.fetch = ((url: string, init?: RequestInit) => {
    const r = impl(url, init);
    return Promise.resolve({ ...r, headers: new Headers(r.headers || {}) });
  }) as typeof fetch;
}

afterEach(() => {
  global.fetch = origFetch;
});

describe('ApiClient', () => {
  test('无 key 抛 401', async () => {
    const c = new ApiClient({ base_url: 'https://x', api_key: '' });
    await assert.rejects(
      () => c.get('/stats'),
      (e: unknown) => e instanceof ApiError && (e as ApiError).status === 401,
    );
  });

  test('非 2xx 抛 ApiError 且归一 detail', async () => {
    mockFetch(() => ({ ok: false, status: 401, statusText: 'Unauthorized', text: async () => JSON.stringify({ detail: '无效的 API Key' }) }));
    const c = new ApiClient({ base_url: 'https://x', api_key: 'k' });
    await assert.rejects(
      () => c.get('/stats'),
      (e: unknown) => e instanceof ApiError && (e as ApiError).status === 401 && /无效/.test((e as ApiError).detail),
    );
  });

  test('200 解析 JSON', async () => {
    mockFetch(() => ({ ok: true, status: 200, text: async () => JSON.stringify({ a: 1 }) }));
    const c = new ApiClient({ base_url: 'https://x', api_key: 'k' });
    const r = await c.get('/x');
    assert.equal(r.a, 1);
  });

  test('GET 拼接 query string', async () => {
    let called = '';
    mockFetch((url) => {
      called = url;
      return { ok: true, status: 200, text: async () => '{}' };
    });
    const c = new ApiClient({ base_url: 'https://x.test', api_key: 'k' });
    await c.get('/search', { q: 'redis', limit: 5, hybrid: false });
    assert.match(called, /^https:\/\/x\.test\/search\?/);
    assert.match(called, /q=redis/);
    assert.match(called, /limit=5/);
  });

  test('POST 带 Bearer + JSON body', async () => {
    let headers: HeadersInit | undefined;
    let body: BodyInit | undefined;
    mockFetch((_url, init) => {
      headers = init?.headers;
      body = init?.body;
      return { ok: true, status: 200, text: async () => '{}' };
    });
    const c = new ApiClient({ base_url: 'https://x', api_key: 'sk_test' });
    await c.post('/ingest', { content: 'hello' });
    const h = headers as Record<string, string>;
    assert.equal(h.Authorization, 'Bearer sk_test');
    assert.equal(h['Content-Type'], 'application/json');
    assert.equal(JSON.parse(body as string).content, 'hello');
  });

  test('非 2xx 收集响应头(小写)+ 解析 body', async () => {
    mockFetch(() => ({
      ok: false, status: 429, statusText: 'Too Many Requests',
      headers: { 'Retry-After': '5', 'RateLimit-Reset': '999' },
      text: async () => JSON.stringify({ detail: '配额满', type: 'daily_quota', reset: 999 }),
    }));
    const c = new ApiClient({ base_url: 'https://x', api_key: 'k' });
    await assert.rejects(
      () => c.get('/ingest'),
      (e: unknown) => {
        if (!(e instanceof ApiError) || e.status !== 429) return false;
        const ae = e as ApiError;
        return ae.headers['retry-after'] === '5'
          && ae.headers['ratelimit-reset'] === '999'
          && ae.body?.type === 'daily_quota';
      },
    );
  });

  test('GET 瞬时错误(503)自动重试后成功——query/search 等读命令不再一撞 5xx 即败', async () => {
    let calls = 0;
    mockFetch(() => {
      calls++;
      if (calls === 1) return { ok: false, status: 503, statusText: 'unavailable', text: async () => 'Service Unavailable' };
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: 1 }) };
    });
    const c = new ApiClient({ base_url: 'https://x', api_key: 'k' });
    const r = await c.get('/search', { q: 'x' });
    assert.equal(r.ok, 1);
    assert.equal(calls, 2);
  });

  test('GET retries:0 → 瞬时错误直接抛(hook 等绝对 deadline 场景)', async () => {
    let calls = 0;
    mockFetch(() => {
      calls++;
      return { ok: false, status: 502, statusText: 'bad gw', text: async () => 'x' };
    });
    const c = new ApiClient({ base_url: 'https://x', api_key: 'k' });
    await assert.rejects(() => c.get('/keywords', undefined, { retries: 0 }));
    assert.equal(calls, 1, '不重试');
  });

  test('GET 超时不重试(重试只会再等一个满超时);网络错误重试', async () => {
    let calls = 0;
    global.fetch = (async () => {
      calls++;
      throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    }) as typeof fetch;
    const c = new ApiClient({ base_url: 'https://x', api_key: 'k' });
    await assert.rejects(
      () => c.get('/x', undefined, { timeoutMs: 50 }),
      (e: unknown) => e instanceof ApiError && e.status === 0 && (e as ApiError).timedOut === true,
    );
    assert.equal(calls, 1, '超时(AbortError)不进重试');

    let netCalls = 0;
    global.fetch = (async () => {
      netCalls++;
      if (netCalls === 1) throw new Error('ECONNRESET');
      return { ok: true, status: 200, text: async () => '{}' } as any;
    }) as typeof fetch;
    assert.deepEqual(await c.get('/x'), {});
    assert.equal(netCalls, 2, '网络故障(非超时)重试');
  });

  test('GET 429 不走内置重试(限流交给调用方按 Retry-After 处理)', async () => {
    let calls = 0;
    mockFetch(() => {
      calls++;
      return { ok: false, status: 429, statusText: 'Too Many Requests', text: async () => JSON.stringify({ detail: '限流' }) };
    });
    const c = new ApiClient({ base_url: 'https://x', api_key: 'k' });
    await assert.rejects(() => c.get('/x'));
    assert.equal(calls, 1);
  });

  test('isTransientError: 5xx/网络=真;超时/429/4xx=假', () => {
    assert.ok(isTransientError(new ApiError(502, 'x')));
    assert.ok(isTransientError(new ApiError(503, 'x')));
    assert.ok(isTransientError(new ApiError(504, 'x')));
    assert.ok(isTransientError(new ApiError(0, '网络错误')));
    assert.ok(!isTransientError(new ApiError(0, '超时', {}, null, true)), '超时不重试');
    assert.ok(!isTransientError(new ApiError(429, 'x')));
    assert.ok(!isTransientError(new ApiError(404, 'x')));
    assert.ok(!isTransientError(new Error('普通错')));
  });
});

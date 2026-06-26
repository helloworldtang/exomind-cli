import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, ApiError } from '../src/api';

const origFetch = global.fetch;

function mockFetch(impl: (url: string, init?: RequestInit) => { ok: boolean; status: number; statusText?: string; text: () => Promise<string> }): void {
  global.fetch = ((url: string, init?: RequestInit) => Promise.resolve(impl(url, init))) as typeof fetch;
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
});

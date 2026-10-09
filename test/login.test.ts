/** login 设备码流程测试(全 mock fetch,无网络)。 */
import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../src/api';
import { deviceLogin } from '../src/commands/login';

const origFetch = global.fetch;

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: { forEach: () => undefined },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

afterEach(() => {
  global.fetch = origFetch;
});

describe('login: 设备码流程', () => {
  test('发起 → pending → 拿到 key', async () => {
    let calls = 0;
    // interval=1s 压轮询间隔;第一次 poll pending,第二次给 key
    global.fetch = (async (url: string | URL, init?: RequestInit): Promise<Response> => {
      const u = String(url);
      if (u.endsWith('/auth/device/code')) {
        return jsonResponse(200, {
          device_code: 'dc-123',
          user_code: 'AB12-CD34',
          expires_in: 60,
          interval: 1,
          verification_url: '/ui/device',
        });
      }
      if (u.endsWith('/auth/device/token')) {
        calls += 1;
        if (calls === 1) return jsonResponse(400, { error: 'authorization_pending' });
        return jsonResponse(200, { api_key: 'sk_live_dev_1' });
      }
      throw new Error(`意外请求: ${u} ${init?.method ?? ''}`);
    }) as typeof fetch;

    const key = await deviceLogin('https://x.test', { openBrowser: false });
    assert.equal(key, 'sk_live_dev_1');
    assert.ok(calls >= 2);
  });

  test('发起端点 404 → 抛 ApiError(login 据此退回粘贴流程)', async () => {
    global.fetch = (async () => jsonResponse(404, { detail: 'Not Found' })) as typeof fetch;
    await assert.rejects(deviceLogin('https://x.test', { openBrowser: false }), (e: unknown) => e instanceof ApiError && e.status === 404);
  });

  test('会话过期(expired_token)→ 明确报错', async () => {
    global.fetch = (async (url: string | URL): Promise<Response> => {
      const u = String(url);
      if (u.endsWith('/auth/device/code')) {
        return jsonResponse(200, { device_code: 'dc-x', user_code: 'AAAA-BBBB', expires_in: 60, interval: 1 });
      }
      return jsonResponse(400, { error: 'expired_token' });
    }) as typeof fetch;
    await assert.rejects(deviceLogin('https://x.test', { openBrowser: false }), /过期/);
  });
});

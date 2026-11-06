/** login 智能登录测试:已有凭据探活仍有效则直接返回,不发起设备码流程。
 * HOME 先指向临时目录再动态 import,与 config.test.ts 同款隔离。 */
import { describe, test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'exomind-login-'));
process.env.HOME = TMP;
process.env.USERPROFILE = TMP;
delete process.env.EXOMIND_API_KEY;
delete process.env.EXOMIND_BASE_URL;

type CfgMod = typeof import('../src/config');
type LoginMod = typeof import('../src/commands/login');
let cfg!: CfgMod;
let loginMod!: LoginMod;

const origFetch = global.fetch;
let requests: string[] = [];

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: { forEach: () => undefined },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

before(async () => {
  cfg = await import('../src/config');
  loginMod = await import('../src/commands/login');
});

afterEach(() => {
  global.fetch = origFetch;
  requests = [];
});

describe('login: 智能登录', () => {
  test('hasFreshCredential: 200 → true;401 → false;网络错误 → false', async () => {
    global.fetch = (async () => jsonResponse(200, [])) as typeof fetch;
    assert.equal(await loginMod.hasFreshCredential('https://x.test', 'sk_ok'), true);

    global.fetch = (async () => jsonResponse(401, { detail: 'invalid' })) as typeof fetch;
    assert.equal(await loginMod.hasFreshCredential('https://x.test', 'sk_bad'), false);

    global.fetch = (async () => {
      throw new Error('network down');
    }) as typeof fetch;
    assert.equal(await loginMod.hasFreshCredential('https://x.test', 'sk_x'), false);
  });

  test('已有有效凭据 → 直接返回,只发一次探活请求,不触发设备码流程', async () => {
    fs.rmSync(cfg.CONFIG_FILE, { force: true });
    cfg.saveConfig({ base_url: 'https://exomind.example', api_key: 'sk_valid' });

    global.fetch = (async (url: string | URL): Promise<Response> => {
      requests.push(String(url));
      return jsonResponse(200, []);
    }) as typeof fetch;

    const client = new (await import('../src/api')).ApiClient({
      base_url: 'https://exomind.example',
      api_key: 'sk_valid',
    });
    await loginMod.default(client, {});

    assert.equal(requests.length, 1);
    assert.ok(requests[0].includes('/keywords'), '探活应打受保护端点 /keywords');
    assert.ok(!requests.some((u) => u.includes('/auth/device/code')), '不应发起设备码流程');
  });

  test('已有凭据已失效(401) → 不提前返回,继续设备码流程', async () => {
    fs.rmSync(cfg.CONFIG_FILE, { force: true });
    cfg.saveConfig({ base_url: 'https://exomind.example', api_key: 'sk_expired' });

    // openBrowser 会 spawn 系统浏览器:把 platform 伪造成 linux → xdg-open 不存在,
    // spawn 异步 error 被 login.ts 的 on('error') 吞掉,测试无副作用
    const realPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    try {
      global.fetch = (async (url: string | URL, init?: RequestInit): Promise<Response> => {
        const u = String(url);
        requests.push(u);
        if (u.endsWith('/keywords')) {
          const auth = String((init?.headers as Record<string, string>)?.Authorization || '');
          // 智能探活(旧 key)→401;登录落盘前校验(新 key)→200
          return auth.includes('sk_expired')
            ? jsonResponse(401, { detail: 'invalid key' })
            : jsonResponse(200, []);
        }
        if (u.endsWith('/auth/device/code')) {
          return jsonResponse(200, {
            device_code: 'dc-1',
            user_code: 'AAAA-BBBB',
            expires_in: 60,
            interval: 1,
            verification_url: '/ui/device',
          });
        }
        if (u.endsWith('/auth/device/token')) return jsonResponse(200, { api_key: 'sk_new' });
        throw new Error(`意外请求: ${u}`);
      }) as typeof fetch;

      const client = new (await import('../src/api')).ApiClient({
        base_url: 'https://exomind.example',
        api_key: 'sk_expired',
      });
      await loginMod.default(client, {});

      assert.ok(requests.some((u) => u.includes('/auth/device/code')), '失效后应走设备码流程');
      assert.equal(cfg.loadConfig().api_key, 'sk_new', '新 key 落盘');
    } finally {
      Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
    }
  });
});

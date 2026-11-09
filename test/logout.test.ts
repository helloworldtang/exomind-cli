/** logout / update 本地凭据测试(HOME 重定向到临时目录,不碰真实 ~/.exomind)。 */
import { describe, test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// 在导入 config 前,把 HOME 指向临时目录,避免污染真实 ~/.exomind
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'exomind-cred-'));
process.env.HOME = TMP;
process.env.USERPROFILE = TMP;
delete process.env.EXOMIND_API_KEY;
delete process.env.EXOMIND_BASE_URL;

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

let config!: typeof import('../src/config');
let logout!: () => Promise<void>;
let update!: typeof import('../src/commands/update')['default'];

before(async () => {
  config = await import('../src/config');
  logout = (await import('../src/commands/logout')).default;
  update = (await import('../src/commands/update')).default;
});

afterEach(() => {
  global.fetch = origFetch;
});

describe('logout', () => {
  test('清除 api_key,保留 base_url', async () => {
    config.saveConfig({ base_url: 'https://example.com', api_key: 'sk_test' });
    await logout();
    const cfg = config.loadConfig();
    assert.equal(cfg.api_key, '');
    assert.equal(cfg.base_url, 'https://example.com');
  });

  test('连 legacy key 文件一起清(loadConfig 兜底读它,不清等于没登出)', async () => {
    config.saveConfig({ base_url: 'https://example.com', api_key: 'sk_test' });
    fs.mkdirSync(path.dirname(config.LEGACY_KEY_FILE), { recursive: true });
    fs.writeFileSync(config.LEGACY_KEY_FILE, 'sk_legacy\n');
    await logout();
    assert.equal(fs.existsSync(config.LEGACY_KEY_FILE), false);
    assert.equal(config.loadConfig().api_key, '');
  });

  test('未登录时无事可做,不报错', async () => {
    config.saveConfig({ base_url: 'https://example.com', api_key: '' });
    await logout(); // 不抛即过
  });
});

describe('update', () => {
  test('--api-key 新 key: 校验通过后落盘覆盖旧 key', async () => {
    config.saveConfig({ base_url: 'https://example.com', api_key: 'sk_old' });
    global.fetch = (async () => jsonResponse(200, { keywords: [] })) as typeof fetch;
    await update(null as never, { apiKey: 'sk_new' });
    assert.equal(config.loadConfig().api_key, 'sk_new');
  });
});

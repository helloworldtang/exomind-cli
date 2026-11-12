/** whoami(me) 凭据有效期渲染测试:有则显示/null=长期/旧服务端无字段不显示。 */
import { describe, test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// 在导入 config 前,把 HOME 指向临时目录,避免污染真实 ~/.exomind
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'exomind-whoami-'));
process.env.HOME = TMP;
process.env.USERPROFILE = TMP;
delete process.env.EXOMIND_API_KEY;
delete process.env.EXOMIND_BASE_URL;

let config!: typeof import('../src/config');
let whoami!: (client: unknown) => Promise<void>;

before(async () => {
  config = await import('../src/config');
  whoami = (await import('../src/commands/whoami')).default;
});

const logs: string[] = [];
const origLog = console.log;
beforeEach(() => {
  logs.length = 0;
  console.log = (...a: unknown[]) => logs.push(a.map(String).join(' '));
});
afterEach(() => {
  console.log = origLog;
});

function run(meBody: Record<string, unknown>): Promise<void> {
  config.saveConfig({ base_url: 'https://example.com', api_key: 'sk_live_test_00000000' });
  const client = { get: async () => meBody };
  return whoami(client);
}

describe('whoami(me): 凭证有效期渲染', () => {
  test('expires_at 有值 → 显示有效期串', async () => {
    await run({
      authenticated: true,
      method: 'api_key',
      tenant_id: '1',
      expires_at: '2027-01-01 00:00:00',
    });
    assert.ok(logs.some((l) => l.includes('2027-01-01 00:00:00')), '应显示有效期串');
  });

  test('expires_at 为 null → 显示长期有效', async () => {
    await run({ authenticated: true, method: 'api_key', tenant_id: '1', expires_at: null });
    assert.ok(logs.some((l) => l.includes('长期有效')), 'null 应显示长期有效');
  });

  test('旧服务端无 expires_at 字段 → 不显示该行(不欠表现)', async () => {
    await run({ authenticated: true, method: 'api_key', tenant_id: '1' });
    assert.ok(!logs.some((l) => l.includes('有效期')), '无字段不应渲染有效期行');
  });
});

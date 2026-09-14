import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// 隔离 CACHE_DIR（须在动态导入 hook/config 之前设置；本文件由 node --test 独立进程运行）
const TEST_CACHE = fs.mkdtempSync(path.join(os.tmpdir(), 'exomind-hook-test-'));
process.env.EXOMIND_CACHE_DIR = TEST_CACHE;

let getKeywordIndex: (client: any, deadline?: number) => Promise<any>;
let CACHE_KEYWORDS: string;

before(async () => {
  const hook = await import('../src/hook');
  const config = await import('../src/config');
  getKeywordIndex = hook.getKeywordIndex;
  CACHE_KEYWORDS = config.CACHE_KEYWORDS;
});

describe('hook: 坏缓存零重试（R10）', () => {
  test('keywords 缓存为坏 JSON：必须不发网络请求、删除损坏缓存、返回 null', async () => {
    assert.ok(CACHE_KEYWORDS.startsWith(TEST_CACHE), '缓存目录须已隔离到临时目录');
    fs.mkdirSync(path.dirname(CACHE_KEYWORDS), { recursive: true });
    fs.writeFileSync(CACHE_KEYWORDS, '{oops-not-json');
    let calls = 0;
    const fakeClient = {
      get: async () => {
        calls++;
        return { names: [], aliases: [] };
      },
    };
    const out = await getKeywordIndex(fakeClient, Date.now() + 3000);
    assert.equal(out, null);
    assert.equal(calls, 0);
    assert.equal(fs.existsSync(CACHE_KEYWORDS), false, '损坏缓存应被删除（下会话重建）');
  });

  test('预算耗尽：不发网络请求、返回 null', async () => {
    let calls = 0;
    const fakeClient = {
      get: async () => {
        calls++;
        return {};
      },
    };
    const out = await getKeywordIndex(fakeClient, Date.now() - 1);
    assert.equal(out, null);
    assert.equal(calls, 0);
  });
});

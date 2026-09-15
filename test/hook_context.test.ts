import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// 隔离 CACHE_DIR(须在动态导入 hook/config 之前设置;本文件由 node --test 独立进程运行)
const TEST_CACHE = fs.mkdtempSync(path.join(os.tmpdir(), 'exomind-ctx-test-'));
process.env.EXOMIND_CACHE_DIR = TEST_CACHE;

let buildContext: (
  client: any,
  msg: string,
  dedup: any,
  now: number,
  deadline?: number,
) => Promise<string>;
let CACHE_KEYWORDS: string;
let CACHE_ENTITIES_DIR: string;

/** 拒绝网络访问的 fake client——命中缓存路径时不应发起任何请求。 */
function offlineClient(): { get: () => Promise<never> } {
  return {
    get: async () => {
      throw new Error('本测试不应发起网络请求');
    },
  };
}

function writeKeywords(names: string[], aliases: string[] = []): void {
  fs.mkdirSync(path.dirname(CACHE_KEYWORDS), { recursive: true });
  fs.writeFileSync(CACHE_KEYWORDS, JSON.stringify({ names, aliases }));
}

function writeEntity(name: string, desc: Record<string, unknown>): void {
  fs.mkdirSync(CACHE_ENTITIES_DIR, { recursive: true });
  fs.writeFileSync(path.join(CACHE_ENTITIES_DIR, `${name}.json`), JSON.stringify(desc));
}

before(async () => {
  const hook = await import('../src/hook');
  const config = await import('../src/config');
  buildContext = hook.buildContext;
  CACHE_KEYWORDS = config.CACHE_KEYWORDS;
  CACHE_ENTITIES_DIR = config.CACHE_ENTITIES_DIR;
});

describe('hook: buildContext 可见提示(不再静默)', () => {
  test('全部候选处于 30 分钟冷却 → 输出一行提示而非空串', async () => {
    assert.ok(CACHE_KEYWORDS.startsWith(TEST_CACHE), '缓存目录须已隔离到临时目录');
    writeKeywords(['Harness', 'harness']);
    const now = Date.now();
    const dedup = { injected: { Harness: now - 5 * 60000, harness: now - 5 * 60000 }, lastArchive: 0 };
    const out = await buildContext(offlineClient(), 'harness 相关的知识', dedup, now);
    assert.ok(out.includes('[ExoMind]'), '须有一行可见提示');
    assert.ok(out.includes('已注入过'), '提示须说明是去重跳过而非无知识');
    assert.ok(out.includes('exomind entity'), '提示须给反查入口');
    assert.ok(!out.includes('[ExoMind 知识飞轮上下文]'), '不应注入上下文块');
  });

  test('关键词表拉取失败 → 输出未注入提示而非空串', async () => {
    // 清掉前面用例写入的新鲜缓存,强制走网络;client 抛错 → getKeywordIndex null
    fs.rmSync(CACHE_KEYWORDS, { force: true });
    const client = {
      get: async () => {
        throw new Error('network down');
      },
    };
    const out = await buildContext(client, '任意话题', { injected: {}, lastArchive: 0 }, Date.now());
    assert.ok(out.includes('本次未注入'), '拉取失败须提示未注入');
    assert.ok(out.includes('exomind search'), '提示须给反查入口');
  });

  test('name 与 alias 双路命中同一实体只注入一次', async () => {
    writeKeywords(['Harness'], ['harness']);
    writeEntity('Harness', { name: 'Harness', description: '实体A', relationships: [] });
    writeEntity('harness', { name: 'Harness', description: '实体A', relationships: [] });
    const dedup = { injected: {}, lastArchive: 0 };
    const out = await buildContext(offlineClient(), '看看 harness', dedup, Date.now());
    assert.equal((out.match(/### Harness/g) || []).length, 1, '同一实体不应重复注入');
    assert.ok(dedup.injected['Harness'] && dedup.injected['harness'], '两路候选都记入冷却');
  });

  test('正常路径:命中且未冷却 → 注入上下文块', async () => {
    writeKeywords(['Redis']);
    writeEntity('Redis', { name: 'Redis', description: '内存数据库', relationships: [] });
    const out = await buildContext(offlineClient(), 'Redis 持久化', { injected: {}, lastArchive: 0 }, Date.now());
    assert.ok(out.startsWith('[ExoMind 知识飞轮上下文]'));
    assert.ok(out.includes('### Redis'));
  });

  test('无任何关键词命中 → 仍返回空串(与失败提示区分)', async () => {
    writeKeywords(['Redis']);
    const out = await buildContext(offlineClient(), '今天天气不错', { injected: {}, lastArchive: 0 }, Date.now());
    assert.equal(out, '');
  });
});

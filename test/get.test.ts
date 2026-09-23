/** get 命令测试:裸名探测 + 详情渲染。 */
import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient } from '../src/api';
import get from '../src/commands/get';

const origFetch = global.fetch;
const origLog = console.log;

afterEach(() => {
  global.fetch = origFetch;
  console.log = origLog;
  process.exitCode = 0;
});

const client = () => new ApiClient({ base_url: 'https://x.test', api_key: '***' });

describe('get', () => {
  test('路径直查:GET /pages/{分段编码路径} 渲染标题与正文', async () => {
    const urls: string[] = [];
    global.fetch = (async (url: string) => {
      urls.push(url);
      return new Response(
        JSON.stringify({ path: 'entities/Redis.md', title: 'Redis', tags: ['缓存'], body: '# Redis\n\n缓存中间件。', mtime: '2026-09-12 08:00', size_bytes: 120 }),
        { status: 200 },
      );
    }) as typeof fetch;
    const buf: string[] = [];
    console.log = (...a: unknown[]) => buf.push(a.map(String).join(' '));
    await get(client(), {}, ['entities/Redis.md']);
    assert.ok(urls[0].includes('/pages/entities/Redis.md'), '路径保留斜杠');
    const out = buf.join('\n');
    assert.ok(out.includes('Redis'), '渲染标题');
    assert.ok(out.includes('缓存中间件'), '渲染正文');
  });

  test('裸实体名:按目录顺序探测解析', async () => {
    const urls: string[] = [];
    global.fetch = (async (url: string) => {
      urls.push(url);
      if (url.includes('/pages/entities/')) {
        return new Response(JSON.stringify({ detail: '页面不存在' }), { status: 404 });
      }
      return new Response(
        JSON.stringify({ path: 'concepts/缓存.md', title: '缓存', body: '概念正文' }),
        { status: 200 },
      );
    }) as typeof fetch;
    const buf: string[] = [];
    console.log = (...a: unknown[]) => buf.push(a.map(String).join(' '));
    await get(client(), {}, ['缓存']);
    assert.ok(urls[0].includes(`/pages/entities/${encodeURIComponent('缓存.md')}`), '先试 entities');
    assert.ok(urls[1].includes(`/pages/concepts/${encodeURIComponent('缓存.md')}`), '再试 concepts');
    assert.ok(buf.join('\n').includes('概念正文'), '渲染解析到的页面');
  });

  test('多页一次取:每个参数各发一次 GET(回归:旧实现 join 成一条路径 → 404)', async () => {
    const urls: string[] = [];
    global.fetch = (async (url: string) => {
      urls.push(url);
      const rel = decodeURIComponent(url.split('/pages/')[1]);
      return new Response(JSON.stringify({ path: rel, title: rel, body: `正文-${rel}` }), { status: 200 });
    }) as typeof fetch;
    const buf: string[] = [];
    console.log = (...a: unknown[]) => buf.push(a.map(String).join(' '));
    await get(client(), {}, ['entities/A.md', 'concepts/B.md']);
    assert.equal(urls.filter((u) => u.includes('/pages/')).length, 2, '2 页应各发一次 GET');
    assert.ok(!urls.some((u) => u.includes('%20')), 'URL 里不得出现空格(join 拼接的痕迹)');
    const out = buf.join('\n');
    assert.ok(out.includes('正文-entities/A.md') && out.includes('正文-concepts/B.md'), '两页都要渲染');
  });

  test('一页 404 不影响其余页,且退出码非 0', async () => {
    global.fetch = (async (url: string) => {
      if (url.includes('B.md')) return new Response(JSON.stringify({ detail: '页面不存在' }), { status: 404 });
      const rel = decodeURIComponent(url.split('/pages/')[1]);
      return new Response(JSON.stringify({ path: rel, title: rel, body: 'ok' }), { status: 200 });
    }) as typeof fetch;
    const buf: string[] = [];
    console.log = (...a: unknown[]) => buf.push(a.map(String).join(' '));
    await get(client(), {}, ['entities/A.md', 'entities/B.md']);
    const out = buf.join('\n');
    assert.ok(out.includes('ok'), '命中的页仍要渲染');
    assert.ok(out.includes('entities/B.md'), '失败页要点名');
    assert.equal(process.exitCode, 1);
  });

  test('无参数 → 报错提示用法', async () => {
    await assert.rejects(() => get(client(), {}, []), /请提供页面路径或实体名/);
  });
});

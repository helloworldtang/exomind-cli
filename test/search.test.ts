import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient } from '../src/api';
import search from '../src/commands/search';

const origFetch = global.fetch;
const origLog = console.log;

/** mock fetch 返回一条 /search 结果，**带 `content`、不带 `snippet`**（服务端真实响应的样子）。 */
function stubSearch(payload: Record<string, unknown>): () => string {
  let u = '';
  global.fetch = (async (url: string) => {
    u = url;
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as typeof fetch;
  return () => u;
}

function captureLogs(): { lines: () => string[] } {
  const buf: string[] = [];
  console.log = (...a: unknown[]) => {
    buf.push(a.map(String).join(' '));
  };
  return { lines: () => buf };
}

afterEach(() => {
  global.fetch = origFetch;
  console.log = origLog;
});

const client = () => new ApiClient({ base_url: 'https://x.test', api_key: 'sk_test' });

describe('search 渲染', () => {
  test('服务端给 content（无 snippet）时，摘要行必须打印出来', async () => {
    // 服务端 /search 实际返回 {path,title,score,content} —— 见 exo/api/query.py 的 /search。
    // 旧实现只读 r.snippet，于是摘要【静默消失】，不报错、不 404，只是少一行。
    const url = stubSearch({
      results: [{ path: 'concepts/缓存.md', title: '缓存', score: 3.5, content: '缓存是把慢存储的结果放在快存储里' }],
    });
    const logs = captureLogs();
    await search(client(), {}, ['缓存']);

    const out = logs.lines().join('\n');
    assert.match(url(), /\/search\?q=/, '应请求 /search');
    assert.ok(out.includes('concepts/缓存.md'), '应打印路径');
    assert.ok(out.includes('缓存是把慢存储的结果放在快存储里'), `摘要没打印出来（只读了 snippet）:\n${out}`);
  });

  test('服务端若同时给了 snippet，优先用 snippet（向前兼容）', async () => {
    stubSearch({ results: [{ path: 'a.md', title: 'A', snippet: '这是 snippet 优先' , content: '不该出现的内容' }] });
    const logs = captureLogs();
    await search(client(), {}, ['a']);
    const out = logs.lines().join('\n');
    assert.ok(out.includes('这是 snippet 优先'));
    assert.ok(!out.includes('不该出现的内容'));
  });

  test('无结果时不炸、给出提示', async () => {
    stubSearch({ results: [] });
    const logs = captureLogs();
    await search(client(), {}, ['不存在的词']);
    assert.ok(logs.lines().join('\n').includes('未找到匹配结果'));
  });
});

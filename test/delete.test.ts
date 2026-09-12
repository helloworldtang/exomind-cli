/** delete / trash 命令测试:mock fetch,验证请求路径/方法/确认交互/渲染。 */
import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient } from '../src/api';
import deletePage from '../src/commands/delete';
import trash from '../src/commands/trash';

const origFetch = global.fetch;
const origLog = console.log;

afterEach(() => {
  global.fetch = origFetch;
  console.log = origLog;
});

const client = () => new ApiClient({ base_url: 'https://x.test', api_key: '***' });

function captureLogs(): { lines: () => string[] } {
  const buf: string[] = [];
  console.log = (...a: unknown[]) => {
    buf.push(a.map(String).join(' '));
  };
  return { lines: () => buf };
}

describe('delete', () => {
  test('--yes 直删:DELETE /pages/{path},输出回收站路径', async () => {
    const calls: Array<{ method: string; url: string }> = [];
    global.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', url });
      if (init?.method === 'DELETE') {
        return new Response(
          JSON.stringify({ deleted: true, path: 'entities/Redis.md', trash_path: '.trash/202609/entities/Redis.md' }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ title: 'Redis' }), { status: 200 });
    }) as typeof fetch;
    const done = captureLogs();
    await deletePage(client(), { yes: true }, ['entities/Redis.md']);
    const delCall = calls.find((c) => c.method === 'DELETE');
    assert.ok(delCall, '应有 DELETE 请求');
    assert.ok(delCall.url.includes('/pages/entities/Redis.md'), `路径应保留斜杠分段: ${delCall.url}`);
    assert.ok(done.lines().join('\n').includes('.trash/202609/entities/Redis.md'), '应输出回收站路径');
  });

  test('未确认(无 --yes 且回答 n)→ 不发 DELETE', async () => {
    const origQuestion = process.stdin;
    const calls: Array<{ method: string }> = [];
    global.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET' });
      return new Response(JSON.stringify({ title: 'Redis' }), { status: 200 });
    }) as typeof fetch;
    // 模拟用户回答 n:替换 stdin
    const { PassThrough } = await import('node:stream');
    const fakeStdin = new PassThrough();
    fakeStdin.write('n\n');
    fakeStdin.end();
    Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });
    try {
      await deletePage(client(), {}, ['entities/Redis.md']);
    } finally {
      Object.defineProperty(process, 'stdin', { value: origQuestion, configurable: true });
    }
    assert.ok(!calls.some((c) => c.method === 'DELETE'), '回答 n 不得发 DELETE');
  });

  test('裸实体名自动解析:先探测各目录的 /pages/{path}', async () => {
    const urls: string[] = [];
    global.fetch = (async (url: string, init?: RequestInit) => {
      urls.push(url);
      if (init?.method === 'DELETE') {
        return new Response(JSON.stringify({ deleted: true, path: 'concepts/缓存.md', trash_path: '.trash/202609/concepts/缓存.md' }), { status: 200 });
      }
      // entities/缓存.md 404,concepts/缓存.md 200(分段编码:斜杠保留,中文转义)
      if (url.includes('/pages/entities/')) {
        return new Response(JSON.stringify({ detail: '页面不存在' }), { status: 404 });
      }
      return new Response(JSON.stringify({ title: '缓存' }), { status: 200 });
    }) as typeof fetch;
    await deletePage(client(), { yes: true }, ['缓存']);
    assert.ok(
      urls.some((u) => u.includes('/pages/concepts/') && u.includes(encodeURIComponent('缓存.md'))),
      '应探测到 concepts/缓存.md',
    );
  });

  test('无参数 → 报错提示用法', async () => {
    await assert.rejects(() => deletePage(client(), {}, []), /请提供页面路径或实体名/);
  });
});

describe('trash', () => {
  test('list:GET /trash 并渲染条目', async () => {
    global.fetch = (async () => {
      return new Response(
        JSON.stringify({
          items: [
            { path: 'entities/Redis.md', trash_path: '.trash/202609/entities/Redis.md', deleted_at: '2026-09-12 08:00', restorable: true },
          ],
          total: 1,
          page: 1,
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const done = captureLogs();
    await trash(client(), { page: 1 }, ['list']);
    const out = done.lines().join('\n');
    assert.ok(out.includes('.trash/202609/entities/Redis.md'), '应列出回收站路径');
    assert.ok(out.includes('共 1 条'), '应显示总数');
  });

  test('restore:POST /trash/restore {trash_path}', async () => {
    const bodies: unknown[] = [];
    global.fetch = (async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ restored: true, path: 'entities/Redis.md' }), { status: 200 });
    }) as typeof fetch;
    const done = captureLogs();
    await trash(client(), {}, ['restore', '.trash/202609/entities/Redis.md']);
    assert.equal((bodies[0] as any).trash_path, '.trash/202609/entities/Redis.md');
    assert.ok(done.lines().join('\n').includes('已恢复'), '应输出恢复成功');
  });

  test('未知子命令 → 报错列可用动作', async () => {
    await assert.rejects(() => trash(client(), {}, ['rename']), /list 列表 \/ restore/);
  });
});

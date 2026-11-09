/** resolvePagePath:裸名→路径解析的契约护栏。
 *  质量点:①新端点命中=单次调用即返回(不再枚举);②path=null=服务端确认没有,
 *  立即报错零枚举(治六连探的核心);③旧服务端 404=端点缺席,回退目录枚举;
 *  ④枚举全 miss 报错。 */
import './_setup_cache';
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';

let m!: typeof import('../src/page_path');
before(async () => {
  m = await import('../src/page_path');
});

function fakeClient(opts: { resolve?: unknown; resolveStatus?: number; pageHit?: string }) {
  const calls: string[] = [];
  const err = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });
  const client = {
    calls,
    async get(p: string, _q?: unknown, _o?: unknown): Promise<any> {
      calls.push(p);
      if (p === '/pages/resolve') {
        if (opts.resolveStatus) throw err(opts.resolveStatus);
        return opts.resolve;
      }
      const target = p.replace(/^\/pages\//, '').split('/').map(decodeURIComponent).join('/');
      if (target === opts.pageHit) return { path: target };
      throw err(404);
    },
  };
  return client;
}

describe('resolvePagePath', () => {
  test('端点命中: 单次调用即返回,不枚举', async () => {
    const c = fakeClient({ resolve: { path: 'sessions/2026-11-08.md', title: 'x' } });
    const r = await m.resolvePagePath(c, '某会话');
    assert.equal(r, 'sessions/2026-11-08.md');
    assert.deepEqual(c.calls, ['/pages/resolve']); // sessions 会话页裸名可达(旧枚举不可达)
  });

  test('path=null: 服务端确认没有,立即报错零枚举', async () => {
    const c = fakeClient({ resolve: { path: null, title: null } });
    await assert.rejects(m.resolvePagePath(c, '不存在'), /页面不存在/);
    assert.deepEqual(c.calls, ['/pages/resolve']); // 六连探不再发生
  });

  test('旧服务端 404: 回退目录枚举并命中', async () => {
    const c = fakeClient({ resolveStatus: 404, pageHit: 'concepts/飞轮.md' });
    const r = await m.resolvePagePath(c, '飞轮');
    assert.equal(r, 'concepts/飞轮.md');
    assert.ok(c.calls.length >= 2 && c.calls[0] === '/pages/resolve');
  });

  test('枚举全 miss: 报错', async () => {
    const c = fakeClient({ resolveStatus: 404 });
    await assert.rejects(m.resolvePagePath(c, '不存在'), /页面不存在/);
  });
});

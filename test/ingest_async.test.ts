/** submitAndWaitReceipt:单条 ingest 异步提交+内建轮询的行为边界。
 *  护栏对象(2026-10-29 设计):done 回执字段透传、failed 报错、预算耗尽转
 *  「未完成」(IncompleteIngestError,exit 3 语义)、轮询 429 退避不吞、
 *  服务器不可达连续失败上限、退避曲线 2s→30s 封顶。 */
import './_setup_cache';
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, type ApiClient } from '../src/api';

type Mod = typeof import('../src/ingest_async');
let m!: Mod;
before(async () => {
  m = await import('../src/ingest_async');
});

/** 轮假客户端:post 序列 + get 序列(gets 可为函数按调用次数返回/抛错)。
 *  返回 live 计数对象(调用方读 state.getCalls,勿在解构时取值——快照永远是 0)。 */
function fakeClient(gets: any[] | ((n: number) => any), posts: any[] = [{ job_id: 7, status: 'pending' }]): {
  client: ApiClient;
  state: { getCalls: number; postCalls: number };
} {
  let gi = 0;
  let pi = 0;
  const state = { getCalls: 0, postCalls: 0 };
  const client = {
    post: async () => {
      state.postCalls++;
      return posts[Math.min(pi++, posts.length - 1)];
    },
    get: async () => {
      state.getCalls++;
      const g = typeof gets === 'function' ? gets(gi++) : gets[Math.min(gi++, gets.length - 1)];
      if (g instanceof Error) throw g;
      return g;
    },
  } as unknown as ApiClient;
  return { client, state };
}

describe('nextPollDelay', () => {
  test('×1.5 增长,30s 封顶,下限 2s', () => {
    assert.equal(m.nextPollDelay(2000), 3000);
    assert.equal(m.nextPollDelay(3000), 4500);
    assert.equal(m.nextPollDelay(20000), 30000);
    assert.equal(m.nextPollDelay(30000), 30000);
    assert.equal(m.nextPollDelay(1), 2000); // 下限兜底
  });
});

describe('submitAndWaitReceipt', () => {
  test('done: 轮询到 done 返回完整回执(附 job_id)', async () => {
    const { client, state } = fakeClient([
      { status: 'pending' },
      { status: 'running' },
      { status: 'done', extracted: true, entities: 2, concepts: 1, summary: 's', created_pages: ['a.md'], updated_pages: [] },
    ]);
    const r = await m.submitAndWaitReceipt(client, { content: 'x' }, { pollIntervalMs: 1, pollBudgetMs: 5000 });
    assert.equal(r.job_id, 7);
    assert.equal(r.entities, 2);
    assert.equal(r.created_pages.length, 1);
    assert.equal(state.getCalls, 3);
  });

  test('failed: 带 error 报错', async () => {
    const { client } = fakeClient([{ status: 'failed', error: 'LLM 不可用' }]);
    await assert.rejects(
      m.submitAndWaitReceipt(client, { content: 'x' }, { pollIntervalMs: 1, pollBudgetMs: 1000 }),
      /处理失败: LLM 不可用/,
    );
  });

  test('预算耗尽 = 未完成(IncompleteIngestError 带 job_id),不是普通失败', async () => {
    const { client } = fakeClient(() => ({ status: 'running' }));
    await assert.rejects(
      m.submitAndWaitReceipt(client, { content: 'x' }, { pollIntervalMs: 1, pollBudgetMs: 0 }),
      (e: unknown) => {
        assert.ok(e instanceof m.IncompleteIngestError);
        assert.equal((e as m.IncompleteIngestError).jobId, 7);
        assert.match((e as Error).message, /仍在后台处理|不可达/);
        return true;
      },
    );
  });

  test('服务器不可达: 连续整轮失败到上限转未完成', async () => {
    const { client, state } = fakeClient(() => new Error('boom'));
    await assert.rejects(
      m.submitAndWaitReceipt(client, { content: 'x' }, { pollIntervalMs: 1, pollBudgetMs: 60_000, maxFailedRounds: 3 }),
      m.IncompleteIngestError,
    );
    assert.equal(state.getCalls, 3);
  });

  test('轮询撞 429: 按 Retry-After 退避后重试,不当场失败', async () => {
    // retry-after 用 0.001s 让测试不等真实 5s
    let n = 0;
    const { client } = fakeClient(() => {
      if (n++ === 0) {
        throw new ApiError(429, 'rate_limit', { 'retry-after': '0.001' }, { type: 'rate_limit' });
      }
      return { status: 'done', extracted: true, entities: 1, concepts: 0 };
    });
    const r = await m.submitAndWaitReceipt(client, { content: 'x' }, { pollIntervalMs: 1, pollBudgetMs: 5000 });
    assert.equal(r.entities, 1);
  });

  test('兜底: 提交响应无 job_id(旧版服务端直接回结果体)则不轮询直接返回', async () => {
    const { client, state } = fakeClient([{ status: 'done' }], [{ entities: 5, concepts: 2 }]);
    const r = await m.submitAndWaitReceipt(client, { content: 'x' }, { pollIntervalMs: 1, pollBudgetMs: 1000 });
    assert.equal(r.entities, 5);
    assert.equal(state.getCalls, 0);
  });

  test('降级(extracted=false)原样透传,由命令层提示 backfill', async () => {
    const { client } = fakeClient([{ status: 'done', extracted: false, entities: 0, concepts: 0 }]);
    const r = await m.submitAndWaitReceipt(client, { content: 'x' }, { pollIntervalMs: 1, pollBudgetMs: 1000 });
    assert.equal(r.extracted, false);
  });
});

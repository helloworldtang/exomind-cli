/** submitAndTrack 回归: 轮询失败显式退出(P0)、降级记状态(P2)、瞬时提交失败入 spool(P1)。
 *  HOME 必须先隔离——本组测试会真实落盘 manifest 与 spool。 */
import './_setup_cache';
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ApiError } from '../src/api';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'exomind-track-'));
process.env.HOME = TMP;
process.env.USERPROFILE = TMP;

type Mod = typeof import('../src/ingest_dir');
let id!: Mod;
type Man = typeof import('../src/manifest');
let man!: Man;
type Sp = typeof import('../src/spool');
let sp!: Sp;
before(async () => {
  id = await import('../src/ingest_dir');
  man = await import('../src/manifest');
  sp = await import('../src/spool');
});

function item(file: string, content: string) {
  return { path: file, content, title: id.deriveTitle(file, content), hash: man.sha256(content) };
}

describe('submitAndTrack', () => {
  test('成功路径: 记账 added + manifest 记录 status=ok', async () => {
    const f = path.join(TMP, 'ok.md');
    const m: man.Manifest = {};
    let jobId = 0;
    const client = {
      post: async () => ({ job_id: ++jobId }),
      get: async () => ({ status: 'done', entities: 2, concepts: 1 }),
    };
    const r = await id.submitAndTrack(client as any, [item(f, '# Ok\n内容')], { pollIntervalMs: 1 }, m);
    assert.equal(r.added, 1);
    assert.equal(r.failed, 0);
    assert.equal(m[f].status, undefined); // ok 为缺省,不落字段(与存量记录兼容)
  });

  test('降级路径: extracted=false → manifest 记 status=degraded,计 degraded', async () => {
    const f = path.join(TMP, 'deg.md');
    const m: man.Manifest = {};
    const client = {
      post: async () => ({ job_id: 1 }),
      get: async () => ({ status: 'done', extracted: false }),
    };
    const r = await id.submitAndTrack(client as any, [item(f, '降级内容')], { pollIntervalMs: 1 }, m);
    assert.equal(r.degraded, 1);
    assert.equal(m[f].status, 'degraded', 'backfill 靠此标记找到降级任务');
  });

  test('轮询连续整轮失败 → 显式计 failed 退出,不等 10min 总超时', async () => {
    const f = path.join(TMP, 'pollfail.md');
    const m: man.Manifest = {};
    const client = {
      post: async () => ({ job_id: 1 }),
      get: async () => {
        throw new ApiError(0, '网络错误');
      },
    };
    const r = await id.submitAndTrack(
      client as any,
      [item(f, '轮询失败内容')],
      { pollIntervalMs: 1, maxFailedRounds: 2 },
      m,
    );
    assert.equal(r.failed, 1, '连续失败轮后计入 failed 并退出');
    assert.equal(m[f], undefined, '未确认完成,不记 manifest(下次重跑)');
  });

  test('轮询单轮失败后恢复 → 不触发退出', async () => {
    const f = path.join(TMP, 'pollrec.md');
    const m: man.Manifest = {};
    let calls = 0;
    const client = {
      post: async () => ({ job_id: 1 }),
      get: async () => {
        calls++;
        if (calls === 1) throw new ApiError(0, '网络错误');
        return { status: 'done', entities: 1, concepts: 0 };
      },
    };
    const r = await id.submitAndTrack(client as any, [item(f, '恢复内容')], { pollIntervalMs: 1, maxFailedRounds: 2 }, m);
    assert.equal(r.added, 1);
    assert.equal(r.failed, 0);
  });

  test('提交瞬时失败(502 重试耗尽) → 入 spool 待 drain;4xx 不入', async () => {
    const fa = path.join(TMP, 'sp1.md');
    const fb = path.join(TMP, 'sp2.md');
    fs.rmSync(path.join(TMP, '.exomind', 'spool'), { recursive: true, force: true });
    const m: man.Manifest = {};
    const client = {
      post: async (_u: string, body: any) => {
        if (body.title === 'sp1') throw new ApiError(502, '网关异常');
        throw new ApiError(400, '内容过长');
      },
      get: async () => ({ status: 'done' }),
    };
    const r = await id.submitAndTrack(
      client as any,
      [item(fa, '瞬时失败内容'), item(fb, '确定性失败内容')],
      { pollIntervalMs: 1 },
      m,
    );
    assert.equal(r.spooled, 1, '502 → spool');
    assert.equal(r.failed, 1, '400 → failed');
    const queued = sp.loadSpool();
    assert.equal(queued.length, 1);
    assert.equal(queued[0].path, fa);
    assert.equal(queued[0].hash, man.sha256('瞬时失败内容'));
  });
});

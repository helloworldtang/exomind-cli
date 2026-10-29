/** 单条 ingest 的「异步提交 + CLI 内建轮询」(2026-10-29 设计定案)。
 *  默认路径不再同步 POST /ingest(一条 HTTP 占住 1-3min),改为:
 *  ① 提交 /ingest/async 秒回 job_id(client_key 幂等,超时重发不二次入队);
 *  ② CLI 进程内轮询 /ingest/status 直到 done/failed/预算耗尽;
 *  ③ done 返回完整回执(与旧同步回执同字段,外加 extracted 降级标志)。
 *
 *  为什么轮询焊在 CLI 里而不是写进 skill 让 AI 约定(2026-10-29 对齐):轮询纪律
 *  (退避/429/总预算/退出码)散落在每个调用方必然长出不一致实现(--dir 429 风暴
 *  自锁教训);AI 侧永远只面对「命令退出码 + 回执文本」这个简单接口。
 *
 *  轮询纪律(继承 429 风暴根治结论):
 *  - 间隔 2s 起、×1.5 增长、30s 封顶(单条 5min 预算内 ≈20 次查询,不刷屏);
 *  - 单次轮询撞 429 走 retryWith429(Retry-After 秒级退避,上限 60s,最多 3 次);
 *  - 总预算默认 5min(EXOMIND_TIMEOUT_MS 可覆盖);耗尽 = 「未完成」而非「失败」:
 *    抛 IncompleteIngestError → exit code 3。重跑同命令经 client_key 幂等复用
 *    续查同一 job,绝不重复入队——这是「未完成」敢用独立退出码的前提。 */
import type { ApiClient } from './api';
import { opTimeout } from './api';
import { ingestWithRetry, retryWith429 } from './ingest_dir';

const POLL_MIN_MS = 2000;
const POLL_MAX_MS = 30000;

/** 「未完成」≠「失败」:任务已提交、仍在后台处理,重跑同命令可续查。 */
export class IncompleteIngestError extends Error {
  readonly jobId: number;
  constructor(jobId: number, message: string) {
    super(message);
    this.name = 'IncompleteIngestError';
    this.jobId = jobId;
  }
}

/** 下一轮轮询间隔:prev × 1.5,夹在 [2s, 30s]。独立导出供单测。 */
export function nextPollDelay(prevMs: number): number {
  return Math.min(Math.max(Math.round(prevMs * 1.5), POLL_MIN_MS), POLL_MAX_MS);
}

export interface PollOpts {
  /** 首轮轮询间隔(ms,测试注入用,生产 2000)。 */
  pollIntervalMs?: number;
  /** 轮询总预算(ms,测试注入用,生产 EXOMIND_TIMEOUT_MS 或 300000)。 */
  pollBudgetMs?: number;
  /** 连续整轮查询失败的上限(服务器不可达判定,默认 5)。 */
  maxFailedRounds?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 提交单条 ingest 并轮询到回执。
 *  Returns: done 的 /ingest/status 响应(含 entities/concepts/summary/created_pages/
 *  updated_pages/extracted),附 job_id。
 *  Throws: Error(处理失败)、IncompleteIngestError(未完成,exit 3)、提交阶段错误原样上抛。 */
export async function submitAndWaitReceipt(
  client: ApiClient,
  payload: Record<string, unknown>,
  opts: PollOpts = {},
): Promise<any> {
  const submit: any = await ingestWithRetry(client, payload, opTimeout(30000), '/ingest/async');
  const jobId = Number(submit?.job_id);
  if (!Number.isFinite(jobId) || jobId <= 0) {
    // 兜底:服务端旧版/异常路径直接回了结果体而非 job —— 照单全收,不轮询
    return submit;
  }
  const budget = opts.pollBudgetMs ?? opTimeout(300000);
  const maxFailedRounds = opts.maxFailedRounds ?? 5;
  const deadline = Date.now() + budget;
  let delay = opts.pollIntervalMs ?? POLL_MIN_MS;
  let failedRounds = 0;
  while (true) {
    let s: any;
    try {
      s = await retryWith429(() => client.get('/ingest/status', { job_id: jobId }));
      failedRounds = 0;
    } catch {
      // 轮询失败 ≠ 任务失败:连续多轮全失败才判「服务器不可达」转未完成
      if (++failedRounds >= maxFailedRounds) {
        throw new IncompleteIngestError(
          jobId,
          `连续 ${failedRounds} 轮查询失败(服务器不可达),任务 job_id=${jobId} 已提交、仍在后台处理`,
        );
      }
      await sleep(delay);
      delay = nextPollDelay(delay);
      continue;
    }
    if (s.status === 'done') return { ...s, job_id: jobId };
    if (s.status === 'failed') throw new Error(`处理失败: ${s.error || '未知错误'} (job_id=${jobId})`);
    if (Date.now() >= deadline) {
      throw new IncompleteIngestError(
        jobId,
        `等待回执超时(${Math.round(budget / 1000)}s),任务 job_id=${jobId} 已提交、仍在后台处理;重跑同命令可续查(幂等,不会重复入队)`,
      );
    }
    await sleep(delay);
    delay = nextPollDelay(delay);
  }
}

/** exomind ingest --dir: 目录批量 + 增量(内容哈希 manifest 去重)。
 *  异步模式:并发提交 /ingest/async(秒回 job_id)→ 轮询 /ingest/status 直到全 done/failed → 汇总。
 *  根治大文件同步 ingest 超 nginx 300s 的 504;并发提交受 --concurrency 控制。 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ApiClient } from './api';
import { opTimeout, ApiError } from './api';
import { sha256, loadManifest, saveManifest, cleanupStale, recordFile, type Manifest } from './manifest';
import { readFileText } from './io';
import { output, green, red, dim } from './format';

export interface DirOpts {
  tag?: string[];
  recursive?: boolean;
  pattern?: string;
  force?: boolean;
  concurrency?: number;
}

/** 简单 glob → RegExp,仅用于文件名匹配(* → .*, ? → .)。 */
export function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

/** 遍历目录,返回匹配的文件绝对路径(已排序)。跳过隐藏文件/目录(.开头)。 */
export function walkDir(dir: string, recursive: boolean, pattern: string): string[] {
  const rx = globToRegex(pattern);
  const out: string[] = [];
  const walk = (d: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (recursive) walk(full);
      } else if (e.isFile() && rx.test(e.name)) {
        out.push(full);
      }
    }
  };
  walk(path.resolve(dir));
  return out.sort();
}

/** 从首个 H1 或文件名推导标题。 */
export function deriveTitle(file: string, content: string): string {
  for (const line of content.split('\n')) {
    const m = line.match(/^#\s+(.+?)\s*$/);
    if (m) return m[1].trim();
  }
  return path.basename(file).replace(/\.[^.]+$/, '');
}

export interface DirPlan {
  toIngest: { path: string; content: string; title: string; hash: string }[];
  toSkip: string[];
}

/** 读取文件并分类: hash 变了/新增/--force → 摄入;否则跳过。 */
export function planIngestest(files: string[], manifest: Manifest, force: boolean): DirPlan {
  const toIngest: DirPlan['toIngest'] = [];
  const toSkip: string[] = [];
  for (const f of files) {
    let content: string;
    try {
      content = readFileText(f);
    } catch {
      continue; // 读不了的文件跳过
    }
    const hash = sha256(content);
    const prev = manifest[f];
    if (!force && prev && prev.hash === hash) {
      toSkip.push(f);
    } else {
      toIngest.push({ path: f, content, title: deriveTitle(f, content), hash });
    }
  }
  return { toIngest, toSkip };
}

/** 并发执行 worker,限制同时在途数量(共享游标模式:N 个 worker 争抢递增游标取任务)。 */
export async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const size = items.length;
  const n = Math.max(1, Math.min(concurrency, size));
  let next = 0;
  const runners: Promise<void>[] = [];
  for (let w = 0; w < n; w++) {
    runners.push(
      (async () => {
        while (true) {
          const idx = next++;
          if (idx >= size) break;
          await worker(items[idx], idx);
        }
      })(),
    );
  }
  await Promise.all(runners);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 是否处于"挂起到次日"状态(供 SIGINT handler 判断是否保存进度)。 */
let suspended = false;

/** 友好错误文案:502/503/504/网络 → 人话;其它截断 message(避免吐裸 nginx HTML)。 */
export function friendlyMsg(e: Error): string {
  if (e instanceof ApiError) {
    if (e.status === 504) return '服务器处理超时';
    if (e.status === 502) return '网关异常';
    if (e.status === 503) return '服务暂不可用';
    if (e.status === 0) return '网络错误';
  }
  return (e.message || String(e)).slice(0, 200);
}

/** 提交 + 限流/瞬时错误重试(POST /ingest 或 /ingest/async):
 *  - 429 rate_limit 与无 type 的 429(中间件频率窗/nginx 限流):Retry-After 秒级退避(上限 60s),最多 5 次。
 *  - 429 daily_quota:挂起到次日 0 点续跑,最多 3 个自然日。
 *  - 502/503/504/网络:指数退避(1s/2s/4s),最多 3 次。
 *  - 其它:原样抛出。 */
export async function ingestWithRetry(
  client: ApiClient,
  payload: unknown,
  timeoutMs: number,
  url: string = '/ingest',
): Promise<any> {
  let rateAttempts = 0;
  let quotaWaits = 0;
  let transientAttempts = 0;
  while (true) {
    try {
      return await client.post(url, payload, { timeoutMs });
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      if (e.status === 429) {
        const type = e.body?.type;
        if (type === 'daily_quota') {
          if (++quotaWaits > 3) throw new ApiError(429, '配额连续 3 个自然日未恢复,放弃');
          await suspendUntilMidnight(Number(e.body?.reset ?? 0));
          continue;
        }
        // rate_limit(并发闸/频率窗)与无 type 的 429(如 nginx 限流)一律退避重试,等待上限 60s
        if (type === 'rate_limit' || type === undefined) {
          if (++rateAttempts >= 5) throw new ApiError(429, '限流,重试 5 次仍失败');
          const retry = Math.min(Number(e.headers['retry-after'] ?? e.body?.retry_after ?? 5), 60);
          const label = type === undefined ? '请求频率超限' : '并发限流';
          process.stderr.write(dim(`  ⏸ ${label},${retry}s 后重试\n`));
          await sleep(retry * 1000);
          continue;
        }
        throw e;
      }
      // 502/503/504/网络:瞬时错误,指数退避,最多 3 次
      if ([502, 503, 504].includes(e.status) || e.status === 0) {
        if (++transientAttempts > 3) throw e;
        const backoff = Math.pow(2, transientAttempts - 1) * 1000;
        process.stderr.write(dim(`  ⏸ ${friendlyMsg(e)},${backoff / 1000}s 后重试 (${transientAttempts}/3)\n`));
        await sleep(backoff);
        continue;
      }
      throw e;
    }
  }
}

/** 瞬时错误(502/503/504/网络)指数退避重试,GET 轮询用。其它错误立即抛出。 */
export async function retryTransient<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const transient = e instanceof ApiError && ([502, 503, 504].includes(e.status) || e.status === 0);
      if (transient && attempt < maxAttempts) {
        await sleep(Math.pow(2, attempt - 1) * 1000);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

/** 挂起到次日 0 点(由 reset epoch 指定),期间打印剩余分钟倒计时。 */
async function suspendUntilMidnight(resetEpoch: number): Promise<void> {
  suspended = true;
  const now = Date.now();
  const waitMs = resetEpoch > 0 ? Math.max(1000, resetEpoch * 1000 - now) : 60 * 1000;
  process.stderr.write(
    dim(`  ⏸ 今日配额已满,挂起到次日 0 点续跑(约 ${Math.ceil(waitMs / 60000)} 分钟)\n`),
  );
  process.stderr.write(dim('  Ctrl+C 可安全退出(已保存进度),次日重跑同命令即可续跑\n'));
  const start = Date.now();
  while (Date.now() - start < waitMs) {
    const remaining = waitMs - (Date.now() - start);
    await sleep(Math.min(60000, remaining));
    const remainMin = Math.ceil((waitMs - (Date.now() - start)) / 60000);
    if (remainMin > 0) process.stderr.write(`\r  ${dim(`剩余约 ${remainMin} 分钟`)}        `);
  }
  process.stderr.write(`\n  ${dim('到达 0 点,继续摄入…')}\n`);
  suspended = false;
}

interface PendingJob {
  file: DirPlan['toIngest'][number];
  jobId: number;
}

/** 执行目录增量摄入(异步):并发提交 /ingest/async → 轮询 /ingest/status → 汇总。
 *  异步秒回避免大文件 504;每 job 完成立即 recordFile/saveManifest(崩溃安全)。 */
export async function runDirIngestest(client: ApiClient, opts: DirOpts, dir: string): Promise<void> {
  const files = walkDir(dir, !!opts.recursive, opts.pattern || '*.md');
  if (!files.length) {
    console.log(dim(`目录 ${dir} 下无匹配文件。`));
    return;
  }

  const manifest = loadManifest();
  const plan = planIngestest(files, manifest, !!opts.force);
  const total = files.length;
  const concurrency = Math.max(1, opts.concurrency ?? 3);
  process.stderr.write(
    `目录 ${dir}: ${total} 文件 — 待摄入 ${plan.toIngest.length},跳过 ${plan.toSkip.length}(异步,并发提交 ${concurrency})\n`,
  );

  // 挂起期间 Ctrl+C:保存已摄入进度
  const onSigInt = (): void => {
    if (suspended) {
      saveManifest(manifest);
      process.stderr.write('\n已保存进度,退出。次日重跑同命令即可续跑。\n');
    }
    process.exit(130);
  };
  process.on('SIGINT', onSigInt);

  let added = 0;
  let updated = 0;
  let failed = 0;
  let degraded = 0;

  // 阶段 1:并发提交 /ingest/async,收 job_id
  const pending: PendingJob[] = [];
  try {
    await mapWithConcurrency(plan.toIngest, concurrency, async (f) => {
      try {
        const res = await ingestWithRetry(
          client,
          { content: f.content, title: f.title, tags: opts.tag },
          30000,
          '/ingest/async',
        );
        pending.push({ file: f, jobId: res.job_id });
      } catch (e) {
        failed++;
        process.stderr.write(`  ${red('✗')} ${path.basename(f.path)} 提交失败 — ${friendlyMsg(e as Error)}\n`);
      }
    });

    // 阶段 2:轮询直到全 done/failed
    const totalJobs = pending.length;
    let done = 0;
    const pollDeadline = Date.now() + opTimeout(600000); // 轮询总超时 10min(EXOMIND_TIMEOUT_MS 可覆盖)
    const inFlight = new Map<number, DirPlan['toIngest'][number]>(
      pending.map((p) => [p.jobId, p.file]),
    );
    while (inFlight.size > 0) {
      if (Date.now() > pollDeadline) {
        for (const [, f] of inFlight) {
          failed++;
          process.stderr.write(`  ${red('✗')} ${path.basename(f.path)} 轮询超时\n`);
        }
        inFlight.clear();
        break;
      }
      await Promise.all(
        [...inFlight.entries()].map(async ([jobId, f]) => {
          try {
            const s = await retryTransient(() => client.get('/ingest/status', { job_id: jobId }));
            if (s.status !== 'done' && s.status !== 'failed') return;
            inFlight.delete(jobId);
            done++;
            if (s.status === 'failed') {
              failed++;
              process.stderr.write(`  ${red('✗')} ${path.basename(f.path)} 处理失败 — ${s.error || '未知错误'}\n`);
              return;
            }
            const prev = manifest[f.path];
            recordFile(manifest, f.path, f.content, f.title);
            saveManifest(manifest);
            if (s.extracted === false) {
              degraded++;
              process.stderr.write(`  ⚠ ${path.basename(f.path)} 降级 — 原文已存,实体抽取待补跑\n`);
            } else if (prev) {
              updated++;
              process.stderr.write(`  ${green('✓')} 更新 — 实体 ${s.entities ?? 0}/概念 ${s.concepts ?? 0}\n`);
            } else {
              added++;
              process.stderr.write(`  ${green('✓')} 新增 — 实体 ${s.entities ?? 0}/概念 ${s.concepts ?? 0}\n`);
            }
          } catch {
            // 单次轮询失败(网络),下轮重试,不计 failed
          }
        }),
      );
      if (inFlight.size > 0) {
        process.stderr.write(`${dim('⏳')} [完成 ${done}/${totalJobs}] 轮询中…\n`);
        await sleep(2000);
      }
    }
    cleanupStale(manifest, dir, files);
    saveManifest(manifest);
  } finally {
    process.removeListener('SIGINT', onSigInt);
  }

  const allUpToDate = added + updated + degraded === 0 && plan.toSkip.length > 0 && failed === 0;
  output(
    { added, updated, degraded, skipped: plan.toSkip.length, failed, total, dir, allUpToDate },
    () => {
      console.log(
        green('✓ 目录摄入完成') +
          dim(
            `: 新增 ${added} / 更新 ${updated} / 降级 ${degraded} / 跳过 ${plan.toSkip.length} / 失败 ${failed} (共 ${total})`,
          ),
      );
      if (degraded > 0) {
        console.log(
          dim(`（${degraded} 条降级:原文已入库,实体抽取待补——可稍后重跑或 exomind ingest --backfill 补跑）`),
        );
      }
      if (allUpToDate) {
        console.log(dim('（全部已是最新,无需重摄;除非用户明确要求强制刷新,否则不要加 --force）'));
      }
    },
  );
}

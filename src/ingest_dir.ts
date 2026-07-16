/** exomind ingest --dir: 目录批量 + 增量(内容哈希 manifest 去重)。
 *  模式参考 LlamaIndex refresh() / Haystack skip: 只对内容变更的文件调用 ingest。 */
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

/** 并发执行 worker,限制同时在途数量(共享游标模式:N 个 worker 争抢递增游标取任务)。
 *  JS 单线程 + worker 内 recordFile/saveManifest 为连续同步调用 → manifest 写入天然串行,无竞争。
 *  弱服务器友好:concurrency 由调用方控制;过高触发服务端 429 rate_limit 时,
 *  ingestWithRetry 的 Retry-After 退避会自适应回压。 */
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

/** 单文件摄入 + 限流重试:
 *  - 429 rate_limit(并发超限): 读 Retry-After 秒级退避,最多 5 次。
 *  - 429 daily_quota(配额超限): 挂起到次日 0 点(reset epoch)自动续跑,最多 3 个自然日防失控。
 *  - 其他错误: 原样抛出(由调用方计入 failed)。 */
export async function ingestWithRetry(
  client: ApiClient,
  payload: unknown,
  timeoutMs: number,
): Promise<any> {
  let rateAttempts = 0;
  let quotaWaits = 0;
  while (true) {
    try {
      return await client.post('/ingest', payload, { timeoutMs });
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 429) throw e;
      const type = e.body?.type;
      if (type === 'daily_quota') {
        if (++quotaWaits > 3) throw new ApiError(429, '配额连续 3 个自然日未恢复,放弃');
        await suspendUntilMidnight(Number(e.body?.reset ?? 0));
        continue;
      }
      if (type === 'rate_limit') {
        if (++rateAttempts >= 5) throw new ApiError(429, '并发限流,重试 5 次仍失败');
        const retry = Number(e.headers['retry-after'] ?? e.body?.retry_after ?? 5);
        process.stderr.write(dim(`  ⏸ 并发限流,${retry}s 后重试\n`));
        await sleep(retry * 1000);
        continue;
      }
      throw e;
    }
  }
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

/** 执行目录增量摄入: 有限并发(默认 3,弱服务器友好),每文件完成后保存 manifest(崩溃安全)。
 *  并发下 manifest 写入靠 JS 单线程 + recordFile/saveManifest 连续同步调用保证串行。 */
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
    `目录 ${dir}: ${total} 文件 — 待摄入 ${plan.toIngest.length},跳过 ${plan.toSkip.length}(并发 ${concurrency})\n`,
  );

  // 挂起期间 Ctrl+C:保存已摄入进度,次日重跑同命令续跑
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
  let started = 0;
  const queue = plan.toIngest;
  try {
    await mapWithConcurrency(queue, concurrency, async (f) => {
      const prev = manifest[f.path];
      const seq = ++started;
      process.stderr.write(`⏳ [${seq}/${queue.length}] ${path.basename(f.path)}…\n`);
      try {
        const res = await ingestWithRetry(
          client,
          { content: f.content, title: f.title, tags: opts.tag },
          opTimeout(300000),
        );
        // recordFile + saveManifest 连续同步调用 → manifest 写入串行,并发安全
        recordFile(manifest, f.path, f.content, f.title);
        saveManifest(manifest);
        if (prev) {
          updated++;
          process.stderr.write(`  ${green('✓')} 更新 — 实体 ${res.entities ?? 0}/概念 ${res.concepts ?? 0}\n`);
        } else {
          added++;
          process.stderr.write(`  ${green('✓')} 新增 — 实体 ${res.entities ?? 0}/概念 ${res.concepts ?? 0}\n`);
        }
      } catch (e) {
        failed++;
        process.stderr.write(`  ${red('✗')} ${(e as Error).message}\n`);
      }
    });
    cleanupStale(manifest, dir, files);
    saveManifest(manifest);
  } finally {
    process.removeListener('SIGINT', onSigInt);
  }

  const allUpToDate = added + updated === 0 && plan.toSkip.length > 0 && failed === 0;
  output(
    { added, updated, skipped: plan.toSkip.length, failed, total, dir, allUpToDate },
    () => {
      console.log(
        green('✓ 目录摄入完成') +
          dim(
            `: 新增 ${added} / 更新 ${updated} / 跳过 ${plan.toSkip.length} / 失败 ${failed} (共 ${total})`,
          ),
      );
      if (allUpToDate) {
        console.log(
          dim('（全部已是最新,无需重摄;除非用户明确要求强制刷新,否则不要加 --force）'),
        );
      }
    },
  );
}

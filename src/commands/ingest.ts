/** exomind ingest — 导入知识。支持参数 / stdin / 文件。 */
import * as path from 'node:path';
import { opTimeout, type ApiClient } from '../api';
import { output, ok, green, red, dim, truncate, hint } from '../format';
import { readStdin, readStdinForced, readFileText } from '../io';
import { runDirIngestest, ingestWithRetry } from '../ingest_dir';
import { submitAndWaitReceipt } from '../ingest_async';
import { loadManifest, saveManifest, recordFile, acquireManifestLock, deriveClientKey, sha256 } from '../manifest';

/** 解析 --dir 的目录路径。容忍两种写法:
 *  - `ingest --dir <目录>`(文档写法,commander 直接给 string)
 *  - `ingest <目录> --dir`(landing 页写法,--dir 无值时 commander 给 true,目录在位置参数里)
 *  landing 页的示例曾按前者报 `argument missing`(第 8.5 节事故),这是服务端护栏
 *  与 CLI 双向修好的 CLI 侧半边;服务端护栏 test_landing_cli_examples_are_well_formed 仍在。 */
export function resolveIngestDir(dir: string | boolean | undefined, args: string[]): string {
  const dirPath = typeof dir === 'string' ? dir : args[0];
  if (!dirPath || dirPath === '-') {
    throw new Error('--dir 需要目录路径。两种写法: exomind ingest --dir <目录> 或 exomind ingest <目录> --dir');
  }
  return dirPath;
}

export default async function ingest(
  client: ApiClient,
  opts: {
    title?: string;
    tag?: string[];
    file?: string;
    dir?: string | boolean;
    recursive?: boolean;
    pattern?: string;
    force?: boolean;
    fast?: boolean;
    /** --no-wait(commander 否定式):false = 提交即回 job_id 不等回执。 */
    wait?: boolean;
    concurrency?: number;
    origin?: string;
    session?: string;
  },
  args: string[],
): Promise<void> {
  if (opts.dir) return runDirIngestest(client, opts, resolveIngestDir(opts.dir, args));

  let content = '';
  let fileAbs: string | null = null;
  let fileRaw: string | null = null;
  if (opts.file) {
    fileRaw = readFileText(opts.file);
    content = fileRaw;
    fileAbs = path.resolve(opts.file);
  } else if (args.length && args[0] === '-') {
    content = await readStdinForced();
  } else if (args.length) {
    content = args.join(' ');
  } else {
    content = await readStdin();
  }

  content = content.trim();
  if (!content) {
    throw new Error('内容为空。用法: exomind ingest "文本" | --file <路径> | echo ... | exomind ingest');
  }
  if (content.length > 50000) {
    throw new Error(`内容过长(${content.length} 字符),上限 50000`);
  }

  if (opts.fast || opts.wait === false) {
    // R3-lite(2026-09-15):快速模式——原文秒存并可立即被检索,实体/关系精炼转后台;
    // Agent 自动存档(hook 触发)推荐用它,不再同步等 LLM 抽取。
    // --no-wait(2026-10-29)是它的显式别名:fire-and-forget 语义一眼可读。
    const fastBody: Record<string, unknown> = { content };
    if (opts.title) fastBody.title = opts.title;
    if (opts.tag && opts.tag.length) fastBody.tags = opts.tag;
    if (opts.origin) fastBody.origin = opts.origin; // R24 前置:hook-auto 打标透传
    if (opts.session) fastBody.session_key = opts.session; // #1038 借鉴:挂会话时间线
    fastBody.client_key = deriveClientKey(sha256(content)); // 提交幂等:超时重发不二次入队
    const result = await ingestWithRetry(client, fastBody, opTimeout(30000), '/ingest/async');
    if (fileAbs && fileRaw !== null) {
      const release = acquireManifestLock(); // 与并发 --dir 互斥(尽力而为,拿不到锁照写)
      try {
        const man = loadManifest();
        recordFile(man, fileAbs, fileRaw, opts.title || path.basename(fileAbs));
        saveManifest(man);
      } finally {
        release?.();
      }
    }
    output(result, () => {
      console.log(ok('已快速存入: 原文已可检索,实体/关系精炼在后台进行'));
      console.log(
        dim(
          `  任务: job_id=${result.job_id} · 进度: ${result.poll ?? `/ingest/status?job_id=${result.job_id}`}`,
        ),
      );
    });
    return;
  }

  // 默认路径(2026-10-29 起为「异步提交 + CLI 内建轮询」):不再一条 HTTP 同步占住
  // 1-3min,而是秒回 job_id 后在 CLI 进程内轮询回执。收益:①服务端执行统一走
  // worker(预算/内存守卫/治理全覆盖);②提交幂等,超时重发永不二次入队;③回执
  // 多了 extracted 降级标志。回执语义与旧同步完全一致,AI 调用方无感。
  const body: Record<string, unknown> = { content };
  if (opts.title) body.title = opts.title;
  if (opts.tag && opts.tag.length) body.tags = opts.tag;
  if (opts.origin) body.origin = opts.origin; // R24 前置:hook-auto 打标透传
  if (opts.session) body.session_key = opts.session; // #1038 借鉴:挂会话时间线

  hint('⏳ 摄入中: 已提交后台处理(LLM 抽取 1-3 分钟),CLI 正在等待回执…');
  body.client_key = deriveClientKey(sha256(content)); // 提交幂等:超时重发/重跑续查不二次入队
  const result = await submitAndWaitReceipt(client, body);

  // --file 摄入记录 manifest(与 --dir 共用同一份,保证跨模式判重:--file 摄过的文件,--dir 会跳过)。
  // 只在拿到 done 回执后记:未完成(超时/不可达)不记,重跑续查后自然补上。
  if (fileAbs && fileRaw !== null) {
    const release = acquireManifestLock(); // 与并发 --dir 互斥(尽力而为,拿不到锁照写)
    try {
      const man = loadManifest();
      recordFile(man, fileAbs, fileRaw, opts.title || path.basename(fileAbs));
      saveManifest(man);
    } finally {
      release?.();
    }
  }

  output(result, () => {
    console.log(ok('已导入服务器知识飞轮'));
    if (opts.title) console.log(dim(`  标题: ${opts.title}`));
    if (result.extracted === false) {
      console.log(red('  ⚠ 降级: 原文已存,实体抽取待补跑 —— 稍后 `exomind backfill` 补齐'));
    }
    console.log(`  ${green('实体')}: ${result.entities ?? 0}   ${green('概念')}: ${result.concepts ?? 0}`);
    if (result.summary) console.log(dim(`  摘要: ${truncate(result.summary, 120)}`));
    if (result.created_pages?.length) {
      console.log(`  ${dim('新建页面')}: ${result.created_pages.map((p: string) => truncate(p, 60)).join(', ')}`);
    }
    if (result.updated_pages?.length) {
      console.log(`  ${dim('更新页面')}: ${result.updated_pages.map((p: string) => truncate(p, 60)).join(', ')}`);
    }
  });
}

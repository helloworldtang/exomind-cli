/** exomind backfill — 补跑降级摄入: 原文已入库、但实体抽取未完成(extracted=false)的文件。
 *  数据源是 manifest 里的 status='degraded' 记录(本地可见,不需要服务端新端点);
 *  成功后状态回写 'ok',仍降级则保持标记可再跑。 */
import * as path from 'node:path';
import type { ApiClient } from '../api';
import { loadManifest, saveManifest, sha256, type Manifest } from '../manifest';
import { submitAndTrack, deriveTitle } from '../ingest_dir';
import { readFileText } from '../io';
import { output, dim, green } from '../format';

export interface BackfillItem {
  path: string;
  content: string;
  title: string;
  hash: string;
}

export interface BackfillSelection {
  /** 可补跑:文件仍在且内容未变。 */
  items: BackfillItem[];
  /** 内容已变更 → 跳过(hash 不同,下次 ingest --dir 会正常重摄)。 */
  changed: string[];
  /** 源文件已不存在 → 跳过。 */
  gone: string[];
}

/** 从 manifest 挑降级记录(--dir 限定范围时只看该目录前缀)。 */
export function selectBackfill(manifest: Manifest, dir?: string): BackfillSelection {
  const prefix = dir ? path.resolve(dir) + path.sep : '';
  const items: BackfillItem[] = [];
  const changed: string[] = [];
  const gone: string[] = [];
  for (const [p, rec] of Object.entries(manifest)) {
    if (rec.status !== 'degraded') continue;
    if (prefix && !p.startsWith(prefix)) continue;
    let content: string;
    try {
      content = readFileText(p);
    } catch {
      gone.push(p);
      continue;
    }
    if (sha256(content) !== rec.hash) {
      changed.push(p);
      continue;
    }
    items.push({ path: p, content, title: rec.title || deriveTitle(p, content), hash: rec.hash });
  }
  return { items, changed, gone };
}

export default async function backfill(
  client: ApiClient,
  opts: { concurrency?: number },
  args: string[],
): Promise<void> {
  const manifest = loadManifest();
  const { items, changed, gone } = selectBackfill(manifest, args[0]);
  if (changed.length) {
    console.log(dim(`（${changed.length} 条内容已变更,跳过——将随下次 ingest --dir 正常重摄）`));
  }
  if (gone.length) {
    console.log(dim(`（${gone.length} 条源文件已不存在,跳过）`));
  }
  if (!items.length) {
    output({ pending: 0, changed: changed.length, gone: gone.length }, () => {
      console.log(dim('无降级任务待补跑。'));
    });
    return;
  }
  const concurrency = opts.concurrency ?? 3;
  process.stderr.write(dim(`补跑 ${items.length} 条降级摄入(并发 ${concurrency})…\n`));
  const r = await submitAndTrack(client, items, { concurrency }, manifest);
  saveManifest(manifest);
  output(
    { ...r, total: items.length, changed: changed.length, gone: gone.length },
    () => {
      console.log(
        green('✓ backfill 完成') +
          dim(`: 补跑成功 ${r.added + r.updated} / 仍降级 ${r.degraded} / 失败 ${r.failed} (共 ${items.length})`),
      );
      if (r.failed > 0) {
        console.log(dim('（失败条目保持降级标记,稍后重跑 exomind backfill 即可）'));
      }
    },
  );
}

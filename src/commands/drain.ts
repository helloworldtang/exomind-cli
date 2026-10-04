/** exomind drain — 补投本地 spool 队列(上次 ingest 因网络/网关失败未提交的文件)。
 *  条目带内容哈希:投递前文件内容已变更/已消失的直接出队(新内容随下次 --dir 正常摄入);
 *  manifest 里已有同哈希记录的说明期间已由别的调用摄入成功,也直接出队。 */
import type { ApiClient } from '../api';
import { loadSpool, resolveDrainCandidates, removeSpooled } from '../spool';
import { loadManifest, saveManifest } from '../manifest';
import { submitAndTrack, deriveTitle } from '../ingest_dir';
import { output, dim, green } from '../format';

export default async function drain(
  client: ApiClient,
  opts: { concurrency?: number },
): Promise<void> {
  const entries = loadSpool();
  if (!entries.length) {
    output({ pending: 0 }, () => console.log(dim('本地补投队列为空(无断网未提交的摄入)。')));
    return;
  }

  const manifest = loadManifest();
  const candidates = resolveDrainCandidates(entries);
  let droppedChanged = 0;
  let droppedAlready = 0;
  const toSubmit: { path: string; content: string; title: string; hash: string; tags?: string[] }[] = [];
  for (const c of candidates) {
    if (c.changed) {
      removeSpooled(c.entry.hash);
      droppedChanged++;
      continue;
    }
    const rec = manifest[c.entry.path];
    // 同 hash 且非 degraded = 期间已被 --dir/--file 成功摄入 → 出队。
    // degraded 记录不算成功(backfill 补跑入队的条目正是这形态),仍需投递重抽取。
    if (rec && rec.hash === c.entry.hash && rec.status !== 'degraded') {
      removeSpooled(c.entry.hash);
      droppedAlready++;
      continue;
    }
    toSubmit.push({
      path: c.entry.path,
      content: c.content,
      title: c.entry.title || deriveTitle(c.entry.path, c.content),
      hash: c.entry.hash,
      tags: c.entry.tags,
    });
  }

  const r = toSubmit.length
    ? await submitAndTrack(client, toSubmit, { concurrency: opts.concurrency }, manifest)
    : { added: 0, updated: 0, degraded: 0, failed: 0, spooled: 0 };
  // 出队:本次投递成功(manifest 记上同哈希)的移除;失败的保留待下次
  let drained = droppedChanged + droppedAlready;
  for (const item of toSubmit) {
    const rec = manifest[item.path];
    if (rec && rec.hash === item.hash) {
      removeSpooled(item.hash);
      drained++;
    }
  }
  saveManifest(manifest);

  output(
    { pending: entries.length, submitted: toSubmit.length, drained, ...r },
    () => {
      console.log(
        green('✓ drain 完成') +
          dim(
            `: 补投成功 ${r.added + r.updated} / 失败 ${r.failed + r.spooled} / 出队 ${drained} (队列共 ${entries.length})`,
          ),
      );
      if (droppedChanged) console.log(dim(`（${droppedChanged} 条内容已变更出队,新内容将随下次 ingest --dir 摄入）`));
      if (droppedAlready) console.log(dim(`（${droppedAlready} 条期间已摄入成功,直接出队）`));
      if (r.spooled > 0 || r.failed > 0) {
        console.log(dim('（失败条目保留在队列,网络恢复后重跑 exomind drain）'));
      }
    },
  );
}

/** exomind delete <page...> — 删除知识页(软删除:入服务端回收站,可恢复)。
 *  对标 memos delete;服务端 DELETE /pages/{path} 入 .trash/ 并清理搜索索引。
 *
 *  ⚠️ `<page...>` 是「页面列表」,不是一个多词短语:每个参数各删一页。
 *  2026-09-23 修复:旧实现 `args.join(' ')` 把 N 页拼成一条畸形路径,而服务端寻址兜底
 *  (`_validated_page` 取路径最后一段按名解析)只认最后一段 → **只删掉最后一页、还报成功**
 *  (静默少删,最坏的一种失败:调用方以为 N 页都删了)。 */
import type { ApiClient } from '../api';
import * as readline from 'node:readline/promises';
import { encPath, resolvePagePath } from '../page_path';
import { output, ok, dim, fail, yellow, hint, isJsonMode } from '../format';

interface Outcome {
  /** 用户原样输入的那一项 */
  requested: string;
  /** 实际请求的页面路径(裸名已解析为精确路径) */
  target: string;
  title: string;
  /** 服务端确认删除的路径与回收站位置 */
  path?: string;
  trash_path?: string;
  /** 服务端原始响应(单页 JSON 输出保持旧形状) */
  raw?: unknown;
  error?: string;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 裸实体名 → 精确路径(走公共探测);带斜杠 / 带 .md 的路径原样返回。 */
async function toTarget(client: ApiClient, page: string): Promise<string> {
  return !page.includes('/') && !page.endsWith('.md') ? resolvePagePath(client, page) : page;
}

/** 删除前取标题用于确认与回显;拿不到不阻断(删除以服务端响应为准)。 */
async function fetchTitle(client: ApiClient, target: string): Promise<string> {
  try {
    const d = await client.get(`/pages/${encPath(target)}`, undefined, { timeoutMs: 15000 });
    return String(d?.title ?? '');
  } catch {
    return '';
  }
}

export default async function deletePage(
  client: ApiClient,
  opts: Record<string, unknown>,
  args: string[],
): Promise<void> {
  // 每个参数 = 一页。绝不 join:「页面列表」不是「一个多词标题」。
  const pages = (args ?? []).map((a) => String(a).trim()).filter(Boolean);
  if (!pages.length) throw new Error('请提供页面路径或实体名: exomind delete entities/Redis.md');

  // ① 先全量解析(裸名要逐个探测目录)。单页解析失败只记账,不打断其余页。
  const plans: Outcome[] = [];
  for (const p of pages) {
    try {
      const target = await toTarget(client, p);
      plans.push({ requested: p, target, title: await fetchTitle(client, target) });
    } catch (e) {
      plans.push({ requested: p, target: p, title: '', error: msg(e) });
    }
  }

  // 确认问句之前先把「哪些没定位到」讲清楚(stderr:不污染 --json 的 stdout)
  for (const p of plans) {
    if (p.error) hint(yellow(`⚠ ${p.requested} 未定位到页面: ${p.error}`));
  }
  const doomed = plans.filter((p) => !p.error);

  // ② 确认:一次问完(多页不逐页打断)
  if (!opts.yes && !isJsonMode() && doomed.length) {
    const head =
      doomed.length === 1
        ? `删除 ${doomed[0].target}${doomed[0].title ? `（${doomed[0].title}）` : ''}？`
        : `删除以下 ${doomed.length} 页？\n${doomed
            .map((p) => `  ${p.target}${p.title ? `（${p.title}）` : ''}`)
            .join('\n')}\n`;
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ans = await rl.question(`${head}入服务端回收站、可恢复 [y/N] `);
    rl.close();
    if (ans.trim().toLowerCase() !== 'y') {
      console.log('已取消');
      return;
    }
  }

  // ③ 逐页删除。一页失败不阻断其余页 —— 中断只会留下更多待删的。
  const done: Outcome[] = [];
  for (const p of plans) {
    if (p.error) {
      done.push(p);
      continue;
    }
    try {
      const r = await client.del(`/pages/${encPath(p.target)}`, { timeoutMs: 60000 });
      done.push({ ...p, path: r?.path, trash_path: r?.trash_path, raw: r });
    } catch (e) {
      done.push({ ...p, error: msg(e) });
    }
  }

  const failed = done.filter((d) => d.error);
  const succeeded = done.filter((d) => !d.error);

  /** 服务端删的与请求的不一致 → 必须说出来:调用方可能刚删掉了另一页。 */
  const mismatch = (d: Outcome): string | null =>
    d.path && d.path !== d.target ? yellow(`  ⚠ 实际删除的是 ${d.path}（请求的是 ${d.target}）`) : null;

  // ④ 输出。单页保持旧形状(JSON 直接透传服务端响应),多页给汇总。
  if (done.length === 1) {
    const d = done[0];
    if (d.error) {
      output({ deleted: false, path: d.target, error: d.error }, () => {
        console.log(fail(`${d.requested} 未删除: ${d.error}`));
      });
    } else {
      output(d.raw ?? { deleted: true, path: d.path, trash_path: d.trash_path }, () => {
        console.log(ok(`已删除: ${d.path}`));
        if (d.trash_path) {
          console.log(dim(`回收站: ${d.trash_path} — exomind trash 查看 / trash restore 恢复`));
        }
        const m = mismatch(d);
        if (m) console.log(m);
      });
    }
  } else {
    output(
      {
        ok: failed.length === 0,
        total: done.length,
        deleted: succeeded.map((d) => ({ requested: d.requested, path: d.path, trash_path: d.trash_path })),
        failed: failed.map((d) => ({ requested: d.requested, target: d.target, error: d.error })),
      },
      () => {
        for (const d of done) {
          if (d.error) {
            console.log(fail(`${d.requested} 未删除: ${d.error}`));
            continue;
          }
          console.log(ok(`已删除: ${d.path}`));
          const m = mismatch(d);
          if (m) console.log(m);
          if (d.trash_path) console.log(dim(`  回收站: ${d.trash_path}`));
        }
        console.log(
          dim(
            `共 ${done.length} 页: ${succeeded.length} 成功${
              failed.length ? `, ${failed.length} 失败` : ''
            } — exomind trash restore <回收站路径> 恢复`,
          ),
        );
      },
    );
  }

  // ⑤ 有失败 → 退出码非 0,脚本/Agent 才能发现「少删了」。
  if (failed.length) process.exitCode = 1;
}

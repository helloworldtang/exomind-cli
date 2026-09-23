/** exomind get <page...> — 获取指定记忆(页面详情):路径(entities/Redis.md)或裸实体名。
 *
 *  ⚠️ `<page...>` 是「页面列表」,每个参数各取一页(2026-09-23 修复:旧实现 `args.join(' ')`
 *  把多页拼成一条路径,只会 404；同一个根因在 delete 上表现为「静默少删」)。 */
import type { ApiClient } from '../api';
import { encPath, resolvePagePath } from '../page_path';
import { output, bold, dim, fail, truncate } from '../format';

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function render(r: any): void {
  console.log(`${bold(r.title)} ${dim(`(${r.path})`)}`);
  if (r.tags?.length) console.log(dim(`标签: ${r.tags.join(', ')}`));
  console.log(dim(`更新: ${r.mtime ?? ''} · ${r.size_bytes ?? 0} 字节`));
  console.log('');
  console.log(truncate(String(r.body ?? ''), 2000));
}

export default async function get(
  client: ApiClient,
  _opts: Record<string, unknown>,
  args: string[],
): Promise<void> {
  const pages = (args ?? []).map((a) => String(a).trim()).filter(Boolean);
  if (!pages.length) throw new Error('请提供页面路径或实体名: exomind get entities/Redis.md');

  const results: any[] = [];
  let failed = 0;
  for (const page of pages) {
    try {
      const target = !page.includes('/') && !page.endsWith('.md') ? await resolvePagePath(client, page) : page;
      results.push(await client.get(`/pages/${encPath(target)}`, undefined, { timeoutMs: 30000 }));
    } catch (e) {
      failed++;
      results.push({ error: msg(e), requested: page });
    }
  }

  if (pages.length === 1) {
    const r = results[0];
    if (r.error) {
      // 单页保持旧行为:报错并退出非 0(json 模式交给 output 打机器可读结构)
      output({ error: r.error, requested: r.requested }, () => console.log(fail(`${r.requested}: ${r.error}`)));
    } else {
      output(r, () => render(r));
    }
  } else {
    output(results, () => {
      results.forEach((r, i) => {
        if (i) console.log('');
        if (r.error) {
          console.log(fail(`${r.requested}: ${r.error}`));
          return;
        }
        render(r);
      });
    });
  }

  if (failed) process.exitCode = 1;
}

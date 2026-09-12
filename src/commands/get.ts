/** exomind get <page> — 获取指定记忆(页面详情):路径(entities/Redis.md)或裸实体名。 */
import type { ApiClient } from '../api';
import { encPath, resolvePagePath } from '../page_path';
import { output, bold, cyan, dim, truncate } from '../format';

export default async function get(
  client: ApiClient,
  _opts: Record<string, unknown>,
  args: string[],
): Promise<void> {
  const page = args.join(' ').trim();
  if (!page) throw new Error('请提供页面路径或实体名: exomind get entities/Redis.md');

  let target = page;
  if (!page.includes('/') && !page.endsWith('.md')) {
    target = await resolvePagePath(client, page);
  }

  const r = await client.get(`/pages/${encPath(target)}`, undefined, { timeoutMs: 30000 });
  output(r, () => {
    console.log(`${bold(r.title)} ${dim(`(${r.path})`)}`);
    if (r.tags?.length) console.log(dim(`标签: ${r.tags.join(', ')}`));
    console.log(dim(`更新: ${r.mtime ?? ''} · ${r.size_bytes ?? 0} 字节`));
    console.log('');
    console.log(truncate(String(r.body ?? ''), 2000));
  });
}

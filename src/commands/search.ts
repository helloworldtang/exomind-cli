/** exomind search <keyword> — 全文/混合/精排搜索。 */
import type { ApiClient } from '../api';
import { retryWith429 } from '../ingest_dir';
import { output, cyan, dim, yellow, truncate } from '../format';
import { formatTrace } from './trace';

export default async function search(
  client: ApiClient,
  opts: { limit?: number; rerank?: boolean; hybrid?: boolean },
  args: string[],
): Promise<void> {
  const keyword = args.join(' ').trim();
  if (!keyword) throw new Error('请提供关键词: exomind search "关键词"');

  const result = await retryWith429(() => client.get('/search', {
    q: keyword,
    limit: opts.limit ?? 10,
    rerank: opts.rerank ?? false,
    hybrid: opts.hybrid ?? false,
  }));

  const results = result.results || [];
  output(result, () => {
    if (!results.length) {
      console.log(yellow('未找到匹配结果。'));
      return;
    }
    console.log(cyan(`找到 ${results.length} 条结果:`));
    results.forEach((r: Record<string, unknown>, i: number) => {
      const title = String(r.title ?? r.path ?? '');
      console.log(`\n  ${i + 1}. ${cyan(title)}`);
      if (r.path) console.log(dim(`     ${r.path}`));
      // 服务端 GET /search 给的是 `content`（正文前 200 字），**没有 `snippet`**。
      // 旧代码只读 r.snippet → 这一行永远不打印（静默少一行，不报错、不 404）。
      const snip = r.snippet ?? r.content;
      if (snip) console.log(dim(`     ${truncate(String(snip), 100)}`));
      if (r.score != null) console.log(dim(`     score: ${r.score}`));
      // 结果级归因:这条被哪几路召回(服务端 2026-11-08 起;旧服务端无此字段不显示)
      if (Array.isArray(r.legs) && r.legs.length) console.log(dim(`     召回路: ${r.legs.join('+')}`));
    });
    formatTrace(result.trace);
  });
}

/** exomind search <keyword> — 全文/混合/精排搜索。 */
import type { ApiClient } from '../api';
import { output, cyan, dim, yellow, truncate } from '../format';

export default async function search(
  client: ApiClient,
  opts: { limit?: number; rerank?: boolean; hybrid?: boolean },
  args: string[],
): Promise<void> {
  const keyword = args.join(' ').trim();
  if (!keyword) throw new Error('请提供关键词: exomind search "关键词"');

  const result = await client.get('/search', {
    q: keyword,
    limit: opts.limit ?? 10,
    rerank: opts.rerank ?? false,
    hybrid: opts.hybrid ?? false,
  });

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
      if (r.snippet) console.log(dim(`     ${truncate(String(r.snippet), 100)}`));
      if (r.score != null) console.log(dim(`     score: ${r.score}`));
    });
  });
}

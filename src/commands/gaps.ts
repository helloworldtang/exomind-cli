/** exomind gaps — 知识缺口。 */
import type { ApiClient } from '../api';
import { output, bold, cyan, dim, green } from '../format';

export default async function gaps(client: ApiClient, opts: { days?: number }): Promise<void> {
  const result = await client.get('/knowledge-gaps', { days: opts.days ?? 30 });
  const gaps = result.gaps || [];
  output(result, () => {
    if (!gaps.length) {
      console.log(green('暂无知识缺口 🎉'));
      return;
    }
    console.log(cyan(`知识缺口 ${result.total_gaps ?? gaps.length} 个 (近 ${result.days} 天):`));
    for (const g of gaps) {
      console.log(`  ${bold(`${g.count}×`)} ${g.query} ${dim(`(最少 ${g.min_results ?? 0} 结果)`)}`);
    }
    console.log(dim('\n提示: 用 exomind ingest 补充以上缺口。'));
  });
}

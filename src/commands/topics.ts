/** exomind topics — 选题推荐。 */
import type { ApiClient } from '../api';
import { output, bold, cyan, dim } from '../format';

export default async function topics(client: ApiClient, opts: { count?: number }): Promise<void> {
  const result = await client.get('/suggest-topics', { count: opts.count ?? 5 });
  const topics = result.topics || [];
  output(result, () => {
    console.log(cyan(`选题推荐 (${topics.length}):`));
    topics.forEach((t: Record<string, unknown>, i: number) => {
      console.log(`\n  ${i + 1}. ${bold(String(t.topic ?? ''))}`);
      if (t.reason) console.log(dim(`     策略: ${t.reason}`));
      if (t.readiness != null) console.log(dim(`     素材充分度: ${Math.round(Number(t.readiness) * 100)}%`));
      if (t.entity_count != null) console.log(dim(`     关联实体: ${t.entity_count} 个`));
    });
  });
}

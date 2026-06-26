/** exomind synthesize <topic> — 主题综合。 */
import type { ApiClient } from '../api';
import { output, bold, cyan, dim } from '../format';

export default async function synthesize(
  client: ApiClient,
  opts: { depth?: number },
  args: string[],
): Promise<void> {
  const topic = args.join(' ').trim();
  if (!topic) throw new Error('请提供主题: exomind synthesize "Redis 持久化"');

  const result = await client.post('/synthesize', { topic, depth: opts.depth ?? 2 }, { timeoutMs: 180000 });

  output(result, () => {
    console.log(bold(result.topic || topic));
    if (result.content) console.log(`\n${result.content}`);
    if (result.insights) console.log(cyan('\n洞察: ') + result.insights);
    if (result.confidence != null) console.log(dim(`\n置信度: ${result.confidence}`));
    if (result.sources?.length) console.log(dim(`来源页数: ${result.sources.length}`));
  });
}

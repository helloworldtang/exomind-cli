/** exomind synthesize <topic> — 主题综合。 */
import { opTimeout, type ApiClient } from '../api';
import { output, bold, cyan, dim, hint } from '../format';

export default async function synthesize(
  client: ApiClient,
  opts: { depth?: number },
  args: string[],
): Promise<void> {
  const topic = args.join(' ').trim();
  if (!topic) throw new Error('请提供主题: exomind synthesize "Redis 持久化"');

  hint('⏳ 综合中: 多源聚合 + 洞察,可能 2-4 分钟…');
  const result = await client.post('/synthesize', { topic, depth: opts.depth ?? 2 }, { timeoutMs: opTimeout(300000) });

  output(result, () => {
    console.log(bold(result.topic || topic));
    if (result.content) console.log(`\n${result.content}`);
    if (result.insights) console.log(cyan('\n洞察: ') + result.insights);
    if (result.confidence != null) console.log(dim(`\n置信度: ${result.confidence}`));
    if (result.sources?.length) console.log(dim(`来源页数: ${result.sources.length}`));
  });
}

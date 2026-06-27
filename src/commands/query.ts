/** exomind query <question> — LLM 问答。 */
import { opTimeout, type ApiClient } from '../api';
import { output, dim, cyan, truncate, hint } from '../format';

export default async function query(
  client: ApiClient,
  opts: { tag?: string[]; model?: string },
  args: string[],
): Promise<void> {
  const question = args.join(' ').trim();
  if (!question) throw new Error('请提供问题: exomind query "你的问题"');

  const body: Record<string, unknown> = { question };
  if (opts.tag?.length) body.tags = opts.tag;
  if (opts.model) body.model = opts.model;

  hint('⏳ 查询中: LLM 检索 + 生成,可能 1-2 分钟…');
  const result = await client.post('/query', body, { timeoutMs: opTimeout(180000) });

  output(result, () => {
    console.log(result.answer || dim('(无回答)'));
    if (result.pages?.length) {
      console.log(dim(`\n引用 ${result.pages_used ?? result.pages.length} 页 (${result.model || 'llm'}):`));
      for (const p of result.pages) console.log(cyan(`  • ${truncate(p, 80)}`));
    }
  });
}

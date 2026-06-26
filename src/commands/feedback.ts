/** exomind feedback <page|entity> positive|negative — 质量反馈(飞轮闭环)。 */
import type { ApiClient } from '../api';
import { output, ok } from '../format';

export default async function feedback(
  client: ApiClient,
  _opts: Record<string, unknown>,
  args: string[],
): Promise<void> {
  if (args.length < 2) {
    throw new Error('用法: exomind feedback <页面路径或实体名> positive|negative');
  }
  const rating = args[args.length - 1];
  const page = args.slice(0, -1).join(' ').trim();
  if (rating !== 'positive' && rating !== 'negative') {
    throw new Error('第二参数必须是 positive 或 negative');
  }

  const result = await client.post('/track/feedback', { path: page, feedback: rating });

  output(result, () => {
    console.log(ok(`已记录反馈: ${page} → ${rating}`));
  });
}

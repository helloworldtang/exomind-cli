/** exomind daily — 每日/近期活动摘要。 */
import type { ApiClient } from '../api';
import { isJsonMode } from '../format';

export default async function daily(client: ApiClient, opts: { days?: number }): Promise<void> {
  const result = await client.get('/daily-summary', { days: opts.days ?? 1 });

  if (typeof result === 'string') {
    // 摘要通常是 Markdown 文本
    console.log(isJsonMode() ? JSON.stringify(result) : result);
    return;
  }
  if (result && typeof result === 'object' && typeof result.report === 'string') {
    console.log(isJsonMode() ? JSON.stringify(result) : result.report);
    return;
  }
  console.log(isJsonMode() ? JSON.stringify(result, null, 2) : JSON.stringify(result, null, 2));
}

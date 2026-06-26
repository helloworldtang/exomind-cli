/** exomind review / review mark — FSRS-5 复习。 */
import type { ApiClient } from '../api';
import { output, ok, bold, cyan, dim, yellow, truncate } from '../format';

export async function list(client: ApiClient, opts: { limit?: number }): Promise<void> {
  const result = await client.get('/review', { limit: opts.limit ?? 12 });
  const reviews = result.reviews || [];
  output(result, () => {
    if (!reviews.length) {
      console.log(yellow('当前没有需要复习的知识。'));
      return;
    }
    console.log(cyan(`待复习 ${result.total_due ?? reviews.length} 条:`));
    for (const r of reviews) {
      console.log(`\n  ${bold(r.name)} ${dim(`[${r.type || ''}] q=${r.quality_score ?? ''} 超期${r.days_overdue ?? 0}d`)}`);
      if (r.description) console.log(dim(`     ${truncate(String(r.description), 100)}`));
      console.log(dim(`     标记: exomind review mark "${r.name}" --rating 3`));
    }
    console.log(dim('\nrating: 1=忘记 2=吃力 3=顺利 4=轻松'));
  });
}

export async function mark(client: ApiClient, opts: { rating?: number }, args: string[]): Promise<void> {
  const name = args.join(' ').trim();
  if (!name) throw new Error('请提供实体名: exomind review mark "Redis" --rating 3');
  const rating = opts.rating ?? 3;
  if (rating < 1 || rating > 4) throw new Error('rating 必须是 1-4 (1=忘记 2=吃力 3=顺利 4=轻松)');

  // /review/mark 用 query 参数 (query.py:1978)
  const result = await client.request('POST', '/review/mark', { query: { name, rating } });

  output(result, () => {
    console.log(ok(`已记录复习: ${name} (rating=${rating})`));
    console.log(dim(`  下次复习: ${result.next_review ?? '?'} (${result.next_interval_days ?? '?'} 天后)`));
    console.log(dim(`  stability=${result.stability ?? '?'} difficulty=${result.difficulty ?? '?'}`));
  });
}

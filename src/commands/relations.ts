/** exomind relations <name> — 关联实体(可达性)。 */
import type { ApiClient } from '../api';
import { output, cyan, dim } from '../format';

export default async function relations(
  client: ApiClient,
  opts: { depth?: number },
  args: string[],
): Promise<void> {
  const name = args.join(' ').trim();
  if (!name) throw new Error('请提供实体名: exomind relations "Redis"');

  const result = await client.get(`/relations/${encodeURIComponent(name)}`, {
    depth: opts.depth ?? 1,
  });

  output(result, () => {
    if (!Array.isArray(result) || !result.length) {
      console.log(dim('未找到关联实体。'));
      return;
    }
    console.log(cyan(`${name} 的关联实体 (depth=${opts.depth ?? 1}):`));
    for (const r of result) {
      console.log(`  ${dim(`${r.hops}跳`)} ${r.name} ${dim(`[${r.type}] w=${r.weight ?? ''}`)}`);
    }
  });
}

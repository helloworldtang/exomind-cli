/** exomind entity <name> — 实体详情 + 关系。 */
import type { ApiClient } from '../api';
import { output, bold, cyan, dim, truncate } from '../format';

export default async function entity(
  client: ApiClient,
  _opts: Record<string, unknown>,
  args: string[],
): Promise<void> {
  const name = args.join(' ').trim();
  if (!name) throw new Error('请提供实体名: exomind entity "Redis"');

  const result = await client.get(`/entities/${encodeURIComponent(name)}`);

  output(result, () => {
    console.log(`${bold(result.name)} ${dim(`[${result.type || 'entity'}]`)} ${cyan(`(${result.connections ?? 0} 连接)`)}`);
    if (result.description) console.log(`\n${truncate(result.description, 600)}`);
    if (result.aliases?.length) console.log(dim(`\n别名: ${result.aliases.join(', ')}`));
    if (result.relationships?.length) {
      console.log(dim(`\n关系 (${result.relationships.length}):`));
      for (const r of result.relationships) {
        console.log(`  ${cyan(r.type)} → ${r.entity} ${dim(`(${r.confidence ?? ''})`)}`);
      }
    }
  });
}

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
    // 描述版本链(服务端 2026-11-09 起,新→旧):纠错排查用——「原来是什么/哪条路径改的」。
    // cause 词表:ingest_longer=摄入更长替换 / merge_absorbed=合并被吸收 / merge_replaced_own=合并让位 / human_edit=人工修正
    if (result.desc_history?.length) {
      console.log(dim(`\n描述历史 (${result.desc_history.length},新→旧):`));
      for (const h of result.desc_history) {
        console.log(dim(`  [${h.ts ?? ''}] ${h.cause ?? ''}${h.by ? ` · ${h.by}` : ''}: ${truncate(String(h.desc ?? ''), 80)}`));
      }
    }
  });
}

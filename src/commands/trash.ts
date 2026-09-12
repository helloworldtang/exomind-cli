/** exomind trash <action> — 服务端回收站:list 列表 / restore <回收站路径> 恢复。
 *  服务端语义:删除 = 移入 .trash/<YYYYMM>/,不物理删除;恢复要求原路径空闲。 */
import type { ApiClient } from '../api';
import { output, ok, cyan, dim, yellow } from '../format';

type TrashOpts = Record<string, any>;

export default async function trash(client: ApiClient, opts: TrashOpts, args: string[]): Promise<void> {
  const action = args[0];
  switch (action) {
    case 'list':
      return doList(client, opts);
    case 'restore':
      return doRestore(client, args[1]);
    default:
      throw new Error(
        `未知 trash 子命令: ${action ?? '(空)'}。可用: list 列表 / restore <回收站路径> 恢复`,
      );
  }
}

async function doList(client: ApiClient, opts: TrashOpts): Promise<void> {
  const r = await client.get('/trash', { page: opts.page ?? 1, page_size: 50 });
  output(r, () => {
    const items = r.items ?? [];
    if (!items.length) {
      console.log('（回收站为空）');
      return;
    }
    for (const it of items) {
      console.log(
        `${cyan(it.trash_path)}\n  ${dim(`原路径: ${it.path ?? ''} · 删除: ${it.deleted_at ?? ''}`)}${
          it.restorable ? '' : yellow(' (原路径被占,恢复会冲突)')
        }`,
      );
    }
    console.log(
      dim(`共 ${r.total} 条 · 第 ${r.page} 页 — 恢复: exomind trash restore <回收站路径>`),
    );
  });
}

async function doRestore(client: ApiClient, trashPath?: string): Promise<void> {
  const p = (trashPath ?? '').trim();
  if (!p) throw new Error('请提供回收站路径: exomind trash restore ".trash/202609/entities/Redis.md"');
  // restore 服务端要刷 FTS/npz 索引,数据多时几十秒 → 超时放宽到 120s
  const r = await client.post('/trash/restore', { trash_path: p }, { timeoutMs: 120000 });
  output(r, () => console.log(ok(`已恢复 → ${r.path}`)));
}

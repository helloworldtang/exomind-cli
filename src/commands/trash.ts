/** exomind trash <action> — 服务端回收站:list 列表 / restore <回收站路径> 恢复。
 *  服务端语义:删除 = 移入 .trash/<YYYYMM>/,不物理删除;恢复要求原路径空闲。 */
import type { ApiClient } from '../api';
import { opTimeout } from '../api';
import { output, ok, cyan, dim, yellow } from '../format';

type TrashOpts = Record<string, any>;

export default async function trash(client: ApiClient, opts: TrashOpts, args: string[]): Promise<void> {
  const action = args[0];
  switch (action) {
    case 'list':
      return doList(client, opts);
    case 'restore':
      return doRestore(client, args.slice(1));
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

async function doRestore(client: ApiClient, targets: string[]): Promise<void> {
  const list = targets.map((t) => t.trim()).filter(Boolean);
  if (!list.length) throw new Error('请提供回收站路径: exomind trash restore ".trash/202609/entities/Redis.md"');
  // 一次只恢复一个:服务端每次都要重建 FTS/npz 索引(2C2G 上可能 1-2 分钟),批量恢复既慢又难判
  // 「恢复到第几个了」。多给目标时**显式报错**——旧实现只读 args[1],后面的静默不恢复也不报错
  // (2026-09-23 修复:静默少做是最坏的失败形态)。
  if (list.length > 1) {
    throw new Error(`一次只能恢复一个:收到 ${list.length} 个路径,请逐个恢复(第 1 个: ${list[0]})`);
  }
  const p = list[0];
  console.log(dim('恢复中…大知识飞轮刷索引可能需要一两分钟,请勿关闭'));
  // restore 服务端要刷 FTS/npz 索引,2C2G 大库实测可超 120s → 放宽到 300s(对齐 draft 生成)
  const r = await client.post('/trash/restore', { trash_path: p }, { timeoutMs: opTimeout(300000) });
  output(r, () => console.log(ok(`已恢复 → ${r.path}`)));
}

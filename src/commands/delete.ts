/** exomind delete <page> — 删除知识页(软删除:入服务端回收站,可恢复)。
 *  对标 memos delete;服务端 DELETE /pages/{path} 入 .trash/ 并清理搜索索引。 */
import type { ApiClient } from '../api';
import * as readline from 'node:readline/promises';
import { output, ok, dim, isJsonMode } from '../format';

/** 页面路径编码:仅编码每段,保留斜杠(服务端 {path:path} 参数依赖真实斜杠分段)。 */
function encPath(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/');
}

/** 裸实体名 → 精确路径:按常见目录顺序探测(GET /pages/{path} 404 即下一个)。 */
async function resolvePage(client: ApiClient, page: string): Promise<string> {
  const dirs = ['entities', 'concepts', 'summaries', 'synthesis', 'qa', 'raw/articles'];
  for (const d of dirs) {
    const cand = `${d}/${page}.md`;
    try {
      await client.get(`/pages/${encPath(cand)}`, undefined, { timeoutMs: 15000 });
      return cand;
    } catch {
      // 404 → 试下一个目录
    }
  }
  throw new Error(
    `页面不存在: ${page}(先 exomind search 或 exomind list 定位;链接框入库的原文在 raw/articles/ 下)`,
  );
}

export default async function deletePage(
  client: ApiClient,
  opts: Record<string, unknown>,
  args: string[],
): Promise<void> {
  const page = args.join(' ').trim();
  if (!page) throw new Error('请提供页面路径或实体名: exomind delete entities/Redis.md');

  let target = page;
  if (!page.includes('/') && !page.endsWith('.md')) {
    target = await resolvePage(client, page);
  }

  // 删除前回显页面标题,让用户确认删的是哪篇(标题来自服务端详情)
  let title = '';
  try {
    const detail = await client.get(`/pages/${encPath(target)}`, undefined, {
      timeoutMs: 15000,
    });
    title = String(detail?.title ?? '');
  } catch {
    // 详情拿不到不阻断(权限/结构差异),删除以服务端响应为准
  }

  if (!opts.yes && !isJsonMode()) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ans = await rl.question(
      `删除 ${target}${title ? `（${title}）` : ''}？入服务端回收站、可恢复 [y/N] `,
    );
    rl.close();
    if (ans.trim().toLowerCase() !== 'y') {
      console.log('已取消');
      return;
    }
  }

  const r = await client.del(`/pages/${encPath(target)}`);
  output(r, () => {
    console.log(ok(`已删除: ${r.path}`));
    if (r.trash_path) console.log(dim(`回收站: ${r.trash_path} — exomind trash 查看 / trash restore 恢复`));
  });
}

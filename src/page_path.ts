/** 页面路径工具:分段编码(保留斜杠,服务端 {path:path} 依赖真实分段)+ 裸名解析。 */

/** 页面路径编码:仅编码每段,保留斜杠。 */
export function encPath(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/');
}

/** 裸实体名 → 精确路径:按常见目录顺序探测(GET /pages/{path} 404 即下一个目录)。 */
export async function resolvePagePath(
  client: { get(p: string, query?: unknown, opts?: unknown): Promise<any> },
  page: string,
): Promise<string> {
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
  throw new Error(`页面不存在: ${page}(先 exomind search 定位)`);
}

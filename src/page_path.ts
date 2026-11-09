/** 页面路径工具:分段编码(保留斜杠,服务端 {path:path} 依赖真实分段)+ 裸名解析。 */

/** 页面路径编码:仅编码每段,保留斜杠。 */
export function encPath(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/');
}

/** 旧服务端兼容:目录前缀顺序探测(v0.37 前的唯一路径,现仅作 /pages/resolve
 *  端点缺席(404)时的回退——老服务端把 /pages/resolve 落进 path 路由回 404)。 */
const LEGACY_DIRS = ['entities', 'concepts', 'summaries', 'synthesis', 'qa', 'sessions', 'raw/articles'];

export async function resolvePagePath(
  client: { get(p: string, query?: unknown, opts?: unknown): Promise<any> },
  page: string,
): Promise<string> {
  // 首选单点解析端点(服务端 2026-11-09 起):一次调用替代目录枚举——
  // 名字不存在时立即报错(旧枚举最坏 6×15s 超时),且覆盖 sessions/ 会话页。
  // 契约:命中 200 {path};确认没有 200 {path:null};端点不存在=旧服务端 404→回退枚举。
  try {
    const r = await client.get('/pages/resolve', { name: page }, { timeoutMs: 15000 });
    if (r?.path) return String(r.path);
    throw new Error(`页面不存在: ${page}(先 exomind search 定位)`);
  } catch (e) {
    if ((e as { status?: number })?.status !== 404) throw e; // path=null 的「不存在」原样上抛
    for (const d of LEGACY_DIRS) {
      const cand = `${d}/${page}.md`;
      try {
        await client.get(`/pages/${encPath(cand)}`, undefined, { timeoutMs: 15000 });
        return cand;
      } catch {
        // 404 → 试下一个目录
      }
    }
  }
  throw new Error(`页面不存在: ${page}(先 exomind search 定位)`);
}

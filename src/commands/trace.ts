/** 检索链路 trace 的人类可读展示(search / query 共用)。
 *  服务端字段:{ legs: string[], degraded: string[] }——legs=本次实际参与的
 *  召回路(bm25/vec/graph/expand/variant),degraded=静默降级原因(如
 *  vec_weak_dropped/graph_unavailable/rerank_absent)。旧服务端无此字段时静默不显示。 */
import { dim, yellow } from '../format';

export function formatTrace(trace: unknown): void {
  const t = trace as { legs?: string[]; degraded?: string[] } | undefined;
  if (!t || (!t.legs?.length && !t.degraded?.length)) return;
  const parts: string[] = [];
  if (t.legs?.length) parts.push(`召回路 ${t.legs.join('+')}`);
  if (t.degraded?.length) parts.push(`降级 ${t.degraded.join(',')}`);
  const line = `[trace] ${parts.join(' · ')}`;
  console.log(t.degraded?.length ? yellow(`\n  ${line}`) : dim(`\n  ${line}`));
}

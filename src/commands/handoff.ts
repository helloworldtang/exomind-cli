/** exomind handoff — 显式接力（R32-3）：
 *  - `exomind handoff [项目名]`  跨项目/跨目录显式认领接力包（完整版，manual 优先）
 *  - `exomind handoff --note "..."`  手动创建接力包（用户/Agent 主动交接，优先级高于自动包）
 *  项目名匹配:精确 project_key > 短名(owner/repo 或 repo)> 子串。 */
import type { ApiClient } from '../api';
import { output, ok, dim } from '../format';
import { resolveProjectKey } from '../project_key';

/** 从服务端项目清单里解析用户给的短名 → 完整 project_key。 */
export function matchProjectKey(input: string, known: string[]): string | null {
  const norm = input.trim().replace(/\.git$/, '');
  if (!norm) return null;
  // ① 精确
  if (known.includes(norm)) return norm;
  // ② 短名等价(owner/repo 或裸 repo)
  const byTail = known.filter((k) => k === norm || k.endsWith(`/${norm}`) || k.split('/').slice(-2).join('/') === norm);
  if (byTail.length === 1) return byTail[0];
  if (byTail.length > 1) return byTail[0]; // 多命中取最近由服务端排序决定,这里给第一个
  // ③ 子串
  const bySub = known.filter((k) => k.toLowerCase().includes(norm.toLowerCase()));
  return bySub.length ? bySub[0] : null;
}

export default async function handoff(
  client: ApiClient,
  opts: { note?: string; cwd?: string },
  args: string[],
): Promise<void> {
  if (opts.note?.trim()) {
    // 手动建包:挂在当前目录的项目键上
    const projectKey = resolveProjectKey(opts.cwd || process.cwd());
    const r = await client.post(
      '/handoff',
      { project_key: projectKey, content: opts.note.trim(), origin: 'manual' },
      { timeoutMs: 10000 },
    );
    output(r, () => {
      console.log(ok(`已创建手动接力包(项目 ${projectKey})——下次该项目会话启动时优先送达`));
    });
    return;
  }

  const name = args.join(' ').trim();
  let projectKey: string;
  if (name) {
    // 显式项目名:先拉时间线拿已知项目清单,再解析
    const list = (await client.get('/sessions', { limit: 100 }, { timeoutMs: 10000 })) as {
      sessions?: { project_key?: string }[];
    };
    const known = [...new Set((list.sessions || []).map((s) => s.project_key).filter((k): k is string => !!k))];
    const matched = matchProjectKey(name, known);
    if (!matched) {
      throw new Error(
        known.length
          ? `未匹配到项目「${name}」。最近活跃项目: ${known.slice(0, 5).join('、')}`
          : `服务端暂无会话记录(项目清单为空),无法解析「${name}」。`,
      );
    }
    projectKey = matched;
  } else {
    projectKey = resolveProjectKey(opts.cwd || process.cwd());
  }

  const r = (await client.get(
    '/handoff/next',
    { project_key: projectKey, session_id: `manual-${Date.now()}` },
    { timeoutMs: 10000 },
  )) as { handoff?: string | null; hint?: string; detail?: string };
  output(r, () => {
    if (r.handoff) {
      console.log(ok(`接力包(项目 ${projectKey}):`));
      console.log(r.handoff);
    } else {
      console.log(dim(r.hint || r.detail || '该项目无进行中的接力。'));
    }
  });
}

/** exomind session-compile — L2 消费入口(薄版):把会话要点经 ingest 管线精炼入库,
 *  挂到当前项目最近一个会话(refined 标记 + 时间线关联)。
 *
 *  设计取舍:session_key 不让调用方操心——按当前目录 project_key 取服务端最近的
 *  会话自动挂靠。与 `ingest` 的分工:ingest 是「知识入库」,session-compile 是
 *  「会话总结归档」——产物挂在项目时间线上,回答「这个会话干了什么」。
 *  大规模自动启用(无人调用的 L2)等 dedup 收口后再议。 */
import type { ApiClient } from '../api';
import { output, ok, dim } from '../format';
import { resolveProjectKey } from '../project_key';

export default async function sessionCompile(
  client: ApiClient,
  opts: { cwd?: string; session?: string; title?: string },
  args: string[],
): Promise<void> {
  const text = args.join(' ').trim();
  if (!text) {
    throw new Error('需要会话要点文本。用法: exomind session-compile "本会话的关键决策与踩坑…"');
  }
  if (text.length > 50000) {
    throw new Error(`文本过长(${text.length} 字符),上限 50000`);
  }

  // session_key:显式 --session 优先,否则取当前项目最近会话
  let sessionKey = opts.session?.trim();
  if (!sessionKey) {
    const projectKey = resolveProjectKey(opts.cwd || process.cwd());
    const list = (await client.get('/sessions', { project_key: projectKey, limit: 1 }, { timeoutMs: 10000 })) as {
      sessions?: { session_key?: string; ended_at_iso?: string }[];
    };
    const latest = list.sessions?.[0];
    if (!latest?.session_key) {
      throw new Error(`项目 ${projectKey} 还没有会话记录(先产生一次会话结束事件,或用 --session 显式指定)。`);
    }
    sessionKey = latest.session_key;
    process.stderr.write(dim(`挂靠最近会话: ${sessionKey}(${latest.ended_at_iso ?? ''})\n`));
  }

  const r = (await client.post(
    '/sessions/compile',
    { session_key: sessionKey, text, ...(opts.title ? { title: opts.title } : {}) },
    { timeoutMs: 30000 },
  )) as { job_id: number };
  output(r, () => {
    console.log(ok('已提交 L2 精炼(后台 LLM 编译,经 ingest 管线入库)'));
    console.log(dim(`  任务: job_id=${r.job_id} · 会话: ${sessionKey}`));
    console.log(dim('  进度: exomind --json stats 或稍后 search 会话标题'));
  });
}

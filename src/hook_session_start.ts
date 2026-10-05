/** exomind hook-session-start — 会话首帧接力注入(R32-1,P3 handoff 的读出侧)。
 *
 *  读 stdin 的 SessionStart payload(cwd/session_id) → 算 project_key →
 *  GET /handoff/next(服务端做三级匹配 + 单次认领) → 接力包输出到 stdout
 *  (Claude Code SessionStart 的输出直接进上下文;OpenClaw 由桥接插件拼进 prependContext)。
 *
 *  服务端 /handoff/next 尚未上线(R31):404/任何失败 → 空输出退出 0(hook 哲学:
 *  绝不阻塞会话启动,端点上线即自动工作,CLI 无需再发版)。
 *  同 session_id 只请求一次(本地标记文件)——Claude Code 的 SessionStart 在
 *  resume/compact 后会再次触发,认领语义是会话级一次,不能重复领。 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ApiClient } from './api';
import { CACHE_DIR, resolveConfig } from './config';
import { readStdin } from './io';
import { resolveProjectKey } from './project_key';

const REQUEST_TIMEOUT_MS = 4000; // 会话启动预算:比 prompt hook 宽,但仍要快

function claimedMarker(sessionId: string): string {
  return path.join(CACHE_DIR, 'handoff-claimed', `${sessionId.replace(/[^a-zA-Z0-9一-龥._-]/g, '_')}.json`);
}

/** 解析 stdin payload → {session_id, cwd, project_key}。 */
export function parseStartPayload(raw: string): {
  session_id?: string;
  cwd?: string;
  project_key?: string;
} {
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const str = (v: unknown): string | undefined =>
      typeof v === 'string' && v.trim() ? v.trim() : undefined;
    const sessionId = str(j.session_id ?? j.sessionId);
    const cwd = str(j.cwd ?? j.workspaceDir) ?? process.cwd();
    // 显式 project_key 优先(桥接场景插件已算过),否则以事件 cwd 现算
    return { session_id: sessionId, cwd, project_key: str(j.project_key) ?? resolveProjectKey(cwd) };
  } catch {
    return { cwd: process.cwd(), project_key: resolveProjectKey(process.cwd()) };
  }
}

/** 同会话是否已请求过(resume/compact 会重触发 SessionStart,认领是会话级一次)。 */
export function alreadyRequested(sessionId: string): boolean {
  try {
    return fs.existsSync(claimedMarker(sessionId));
  } catch {
    return false;
  }
}

function markRequested(sessionId: string, projectKey: string): void {
  try {
    fs.mkdirSync(path.dirname(claimedMarker(sessionId)), { recursive: true });
    fs.writeFileSync(claimedMarker(sessionId), JSON.stringify({ ts: new Date().toISOString(), project_key: projectKey }));
  } catch {
    /* 标记失败最多重复请求一次,服务端认领守卫兜底 */
  }
}

/** 拉接力包;无包/端点未上线/任何失败 → ''(静默)。 */
export async function fetchHandoff(client: ApiClient, sessionId: string, projectKey: string, cwd: string): Promise<string> {
  try {
    const r = (await client.get('/handoff/next', { project_key: projectKey, cwd, session_id: sessionId }, {
      timeoutMs: REQUEST_TIMEOUT_MS,
      retries: 0, // 会话启动路径不重试(失败=无接力,下条 prompt 的关键词注入照常工作)
    })) as { handoff?: string; content?: string; detail?: string };
    // 服务端"无包"也给一行线索(R31-5 无包不沉默):最近活跃项目提示
    return String(r.handoff ?? r.content ?? r.detail ?? '').trim();
  } catch {
    return ''; // 404(端点未上线)/网络失败 → 静默,绝不阻塞会话启动
  }
}

export async function runSessionStartHook(client: ApiClient): Promise<void> {
  const raw = await readStdin();
  const { session_id: sessionId, cwd, project_key: projectKey } = parseStartPayload(raw);
  if (!sessionId || !projectKey) return; // 无 session_id 无法做会话级认领标记,跳过
  if (alreadyRequested(sessionId)) return;
  markRequested(sessionId, projectKey);
  const text = await fetchHandoff(client, sessionId, projectKey, cwd ?? process.cwd());
  if (text) process.stdout.write(text + '\n');
}

/** 独立入口(hook 命令用,自建 client;失败全程静默)。 */
export async function runSessionStartStandalone(): Promise<void> {
  try {
    const { ApiClient } = await import('./api');
    await runSessionStartHook(new ApiClient(resolveConfig()));
  } catch {
    /* ignore */
  }
}

/** exomind hook-session-end — SessionEnd 事件采集探针(P3 会话编译的前置)。
 *
 *  读 stdin 的 hook payload,追加一条事件到 ~/.exomind/sessions/events.jsonl。
 *  纯本地、零 token、绝不调服务端、任何失败静默退出 0(会话结束路径不容阻塞)。
 *
 *  为什么先做采集而不是编译:SessionEnd 触发可靠性是业界已知弱点(直接关终端/
 *  Ctrl+C 可能漏触发;ai-memory 靠事件流+finalize-session 兜底)。先落两周事件流:
 *  ① 实测各宿主漏报率,为 P3 的编译时机设计供数 ② transcript_path 是未来
 *  会话编译的素材指针,先记下来 ③ P3 服务端就绪时直接消费这份现成数据。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CONFIG_DIR } from './config';
import { readStdin } from './io';

export const SESSIONS_DIR = path.join(CONFIG_DIR, 'sessions');
export const SESSION_EVENTS = path.join(SESSIONS_DIR, 'events.jsonl');

export interface SessionEndEvent {
  ts: string;
  /** 事件来源: claude / openclaw / manual。 */
  source: string;
  session_id?: string;
  /** 会话转录路径(Claude Code SessionEnd 提供)——未来编译的素材指针。 */
  transcript_path?: string;
  cwd?: string;
  reason?: string;
}

/** 从任意 hook payload 归一出事件(Claude Code SessionEnd: session_id/transcript_path/
 *  cwd/reason;OpenClaw session_end 事件形状不同,字段尽力取)。 */
export function normalizeEvent(raw: string, source: string, now = new Date()): SessionEndEvent {
  let j: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') j = parsed as Record<string, unknown>;
  } catch {
    /* 裸文本也记一条(至少知道事件发生过) */
  }
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined;
  const ev: SessionEndEvent = {
    ts: now.toISOString(),
    source,
    session_id: str(j.session_id ?? j.sessionId),
    transcript_path: str(j.transcript_path ?? j.transcriptPath),
    cwd: str(j.cwd ?? j.workspaceDir),
    reason: str(j.reason),
  };
  return Object.fromEntries(Object.entries(ev).filter(([, v]) => v !== undefined)) as SessionEndEvent;
}

/** 追加事件(文件级 append;单行 jsonl,不做并发锁——追加写 < PIPE_BUF 原子)。 */
export function appendEvent(ev: SessionEndEvent): boolean {
  try {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    fs.appendFileSync(SESSION_EVENTS, JSON.stringify(ev) + '\n');
    return true;
  } catch {
    return false; // 采集失败不阻塞会话结束
  }
}

export async function runSessionEndHook(): Promise<void> {
  const raw = await readStdin();
  if (!raw.trim()) return; // 空 payload 不记(避免手工误触发污染)
  appendEvent(normalizeEvent(raw, 'claude'));
}

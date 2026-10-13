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
import type { ApiClient } from './api';
import { CONFIG_DIR, resolveConfig } from './config';
import { readStdin } from './io';
import { resolveProjectKey } from './project_key';

export const SESSIONS_DIR = path.join(CONFIG_DIR, 'sessions');
export const SESSION_EVENTS = path.join(SESSIONS_DIR, 'events.jsonl');

export interface SessionEndEvent {
  ts: string;
  /** 事件来源: claude / openclaw / manual。 */
  source: string;
  session_id?: string;
  /** 项目身份键(R31 handoff 三级匹配键:git remote > 目录)——以事件 cwd 计算,
   *  非 process.cwd()(OpenClaw 网关桥接时两者不同)。 */
  project_key?: string;
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
  const cwd = str(j.cwd ?? j.workspaceDir);
  const ev: SessionEndEvent = {
    ts: now.toISOString(),
    source,
    session_id: str(j.session_id ?? j.sessionId),
    // project_key 允许调用方显式传入(j.project_key,未来探针上报管道复用);
    // 缺失时以事件 cwd 现算——cwd 也没有就落 undefined(服务端按 source 兜底)。
    project_key: str(j.project_key) ?? (cwd ? resolveProjectKey(cwd) : undefined),
    transcript_path: str(j.transcript_path ?? j.transcriptPath),
    cwd,
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
  const ev = normalizeEvent(raw, 'claude');
  appendEvent(ev);
  // R32-5 上报管道:服务端幂等(session_key),失败静默——本地 events.jsonl 仍是
  // 完整重放源,下次会话结束时同样的事件会再次上报(服务端 created=false 去重)。
  try {
    const { ApiClient } = await import('./api');
    const client: ApiClient = new ApiClient(resolveConfig());
    await client.post(
      '/sessions/end',
      {
        source: ev.source,
        session_id: ev.session_id,
        project_key: ev.project_key,
        cwd: ev.cwd,
        transcript_path: ev.transcript_path,
        reason: ev.reason,
      },
      { timeoutMs: 8000, retries: 0 }, // 会话结束路径:不重试不阻塞(spool 哲学的静默变体)
    );
    markReported(ev); // R30-4:上报成功才标记,失败留给 SessionStart 补投
  } catch {
    /* 服务端未上线/网络失败 → 本地事件已落,后续重放兜底 */
  }
}

// ─── R30-4 漏报补报:reported 标记 + 未上报事件清单 ───
// 背景:SessionEnd 触发可靠性是业界已知弱点(关终端/Ctrl+C 漏触发是上游问题),
// 但「触发了却上报失败」是 CLI 能治的——上报成功记 session_key 到 reported.json,
// SessionStart(hook-session-start)时把未标记的旧事件限量补投,服务端幂等兜底。

const REPORTED_FILE = path.join(SESSIONS_DIR, 'reported.json');

function loadReported(): Set<string> {
  try {
    const arr = JSON.parse(fs.readFileSync(REPORTED_FILE, 'utf-8'));
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveReported(keys: Set<string>): void {
  try {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    // 集合无界增长防护:只留最近 500 个
    const arr = [...keys].slice(-500);
    fs.writeFileSync(REPORTED_FILE, JSON.stringify(arr));
  } catch {
    /* 标记失败最多重复补报,服务端幂等兜底 */
  }
}

export function markReported(ev: SessionEndEvent): void {
  if (!ev.session_id) return;
  const keys = loadReported();
  keys.add(`${ev.source}:${ev.session_id}`);
  saveReported(keys);
}

export function eventKey(ev: SessionEndEvent): string {
  return `${ev.source}:${ev.session_id ?? ''}`;
}

/** 读本地事件流,挑出未上报且 7 天内的(补投候选,倒序取最新)。 */
export function loadUnreported(maxAgeDays = 7): SessionEndEvent[] {
  const reported = loadReported();
  const cutoff = Date.now() - maxAgeDays * 86400_000;
  const out: SessionEndEvent[] = [];
  try {
    const lines = fs.readFileSync(SESSION_EVENTS, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const ev = JSON.parse(line) as SessionEndEvent;
        if (!ev.session_id) continue;
        if (reported.has(eventKey(ev))) continue;
        if (new Date(ev.ts).getTime() < cutoff) continue;
        out.push(ev);
      } catch {
        /* 坏行跳过 */
      }
    }
  } catch {
    return [];
  }
  // 去重(同 key 取最新)后按时间倒序
  const byKey = new Map<string, SessionEndEvent>();
  for (const ev of out) byKey.set(eventKey(ev), ev);
  return [...byKey.values()]
    .sort((a, b) => (a.ts < b.ts ? 1 : -1))
    .slice(0, 10); // 上限 10:防陈年积压一次性冲服务端
}

/** 补投一批事件(R30-4):服务端幂等,单条失败跳过,全部静默。 */
export async function replayUnreported(client: Pick<ApiClient, 'post'>): Promise<number> {
  const pending = loadUnreported();
  let ok = 0;
  for (const ev of pending) {
    try {
      await client.post(
        '/sessions/end',
        {
          source: ev.source,
          session_id: ev.session_id,
          project_key: ev.project_key,
          cwd: ev.cwd,
          transcript_path: ev.transcript_path,
          reason: ev.reason,
        },
        { timeoutMs: 5000, retries: 0 },
      );
      markReported(ev);
      ok++;
    } catch {
      /* 单条失败留到下次 */
    }
  }
  return ok;
}

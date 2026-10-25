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
import * as readline from 'node:readline';
import { spawn } from 'node:child_process';
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

/** 上报单条事件到服务端(R32-5 上报管道,同步网络调用——只应在后台/补投路径用,
 *  绝不在 hook 主路径直接 await,否则会话退出被网络 RTT 卡住)。
 *  服务端幂等(session_key),失败静默——本地 events.jsonl 仍是完整重放源。 */
export async function reportEvent(client: Pick<ApiClient, 'post'>, ev: SessionEndEvent): Promise<boolean> {
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
      { timeoutMs: 8000, retries: 0 }, // 不重试:失败留给 SessionStart 补投兜底
    );
    markReported(ev); // R30-4:上报成功才标记,失败留给 SessionStart 补投
    return true;
  } catch {
    return false; // 服务端未上线/网络失败 → 本地事件已落,后续重放兜底
  }
}

/** 空会话判别(v0.30.0,2026-10-25 用户体验修复):transcript 里一条用户消息都没有,
 *  即"打开就退出、什么都没干"的会话。对 P3 会话编译零价值(编译出来只是噪声实体),
 *  故只落本地 events.jsonl(漏报率统计的分母),不上报服务端——上报是手段不是目的。
 *
 *  判据:逐行流式扫 `"type":"user"`(Claude Code transcript 为紧凑 JSON 无空格),
 *  命中即停。tool_result 在 CC transcript 里也是 type:user,会把"跑了工具"误判为
 *  非空——方向保守(多报不漏报),可接受。transcript 缺失/读不了 → 视为非空照报
 *  (OpenClaw 场景无 transcript_path,不能因判不了就丢数据)。 */
export async function isEmptySession(transcriptPath?: string): Promise<boolean> {
  if (!transcriptPath) return false;
  try {
    if (!fs.statSync(transcriptPath).isFile()) return false;
  } catch {
    return false;
  }
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: fs.createReadStream(transcriptPath, { encoding: 'utf-8' }),
    });
    let done = false;
    const finish = (v: boolean) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    rl.on('line', (line) => {
      if (line.includes('"type":"user"')) {
        finish(false); // 必须先 finish 再 close——Node 会同步发 'close',顺序反了会误判空会话
        rl.close();
      }
    });
    rl.on('close', () => finish(true));
    rl.on('error', () => finish(false));
  });
}

/** detached spawn 自己做后台上报:父进程(hook 主路径)立即退出,网络 RTT 由后台
 *  子进程消化。子进程带 EXOMIND_SESSION_REPORT_EVENT 载荷重跑 hook-session-end,
 *  走 runSessionEndHook 开头的上报-only 分支——零新增子命令/选项,契约面不动
 *  (v0.27/0.28 镜像护栏连咬两次的教训)。
 *  spawn 失败不补救:本地事件已落,SessionStart 补投兜底。 */
function spawnDetachedReport(ev: SessionEndEvent): void {
  try {
    // execPath+argv[1] 双参形式:bin shim(shebang 可执行)与 `node dist/cli.js`
    // 直跑(argv[1] 是裸 JS,单参 spawn 会 ENOENT)都正确重入自身。
    const entry = process.argv[1];
    if (!entry) return; // 无入口可重入 → SessionStart 补投兜底
    const child = spawn(process.execPath, [entry, 'hook-session-end'], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, EXOMIND_SESSION_REPORT_EVENT: JSON.stringify(ev) },
    });
    child.unref();
  } catch {
    /* 后台化失败 → SessionStart 补投 */
  }
}

export async function runSessionEndHook(): Promise<void> {
  // 后台上报模式(父 hook detached spawn 过来):只上报,不读 stdin 不落盘。
  const bgPayload = process.env.EXOMIND_SESSION_REPORT_EVENT;
  if (bgPayload) {
    try {
      const ev = JSON.parse(bgPayload) as SessionEndEvent;
      const { ApiClient } = await import('./api');
      await reportEvent(new ApiClient(resolveConfig()), ev);
    } catch {
      /* 静默:本地事件留待 SessionStart 补投 */
    }
    return;
  }
  const raw = await readStdin();
  if (!raw.trim()) return; // 空 payload 不记(避免手工误触发污染)
  const ev = normalizeEvent(raw, 'claude');
  appendEvent(ev);
  // 空会话只落本地不上报(见 isEmptySession 注释);非空上报转后台,主路径 <100ms。
  if (await isEmptySession(ev.transcript_path)) return;
  spawnDetachedReport(ev);
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
    if (await reportEvent(client, ev)) ok++;
  }
  return ok;
}

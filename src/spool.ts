/** 离线补投队列: ~/.exomind/spool/ — ingest 提交遭遇瞬时/网络失败时落一条,
 *  `exomind drain`(或下次重跑同目录)补投。借自 ai-memory 的
 *  「本地 spool + 稳定幂等键 + 事后投递」模式(hook-drain)。
 *
 *  - 幂等键 = 内容 sha256:同内容只存一条,重复失败不膨胀。
 *  - 只存文件型摄入(--dir / --file)的 path+hash+title+tags;stdin/参数文本
 *    无持久源,不 spool(失败即报错,与旧行为一致)。
 *  - 服务端暂无幂等键配合:网络错误的 POST 可能已达服务端,补投有小概率重复,
 *    由服务端按标题 upsert 语义兜底(可接受的 at-least-once)。
 *  - 文件内容已变更(hash 不符)的条目直接出队——新内容会随下次 --dir 正常摄入。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CONFIG_DIR } from './config';
import { sha256 } from './manifest';
import { readFileText } from './io';

export const SPOOL_DIR = path.join(CONFIG_DIR, 'spool');

export interface SpoolEntry {
  /** 绝对路径(投递时重读文件)。 */
  path: string;
  /** 入队时的内容 sha256——投递前校验,变了就出队。 */
  hash: string;
  title: string;
  tags?: string[];
  queued_at: string;
}

function entryFile(hash: string): string {
  return path.join(SPOOL_DIR, `${hash}.json`);
}

/** 提交失败时入队(同内容幂等:按 hash 覆盖写)。 */
export function spoolEntry(e: SpoolEntry): void {
  try {
    fs.mkdirSync(SPOOL_DIR, { recursive: true });
    fs.writeFileSync(entryFile(e.hash), JSON.stringify(e, null, 2));
  } catch {
    /* spool 失败不阻塞主流程(等价于旧行为:失败就失败) */
  }
}

export function loadSpool(): SpoolEntry[] {
  try {
    return fs
      .readdirSync(SPOOL_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(SPOOL_DIR, f), 'utf-8')) as SpoolEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is SpoolEntry => !!e && typeof e.path === 'string' && typeof e.hash === 'string');
  } catch {
    return [];
  }
}

export function removeSpooled(hash: string): void {
  try {
    fs.unlinkSync(entryFile(hash));
  } catch {
    /* 不存在即已出队 */
  }
}

export interface DrainCandidate {
  entry: SpoolEntry;
  content: string;
  /** 入队后文件内容已变更 → 不投(新内容随下次 --dir 正常摄入)。 */
  changed: boolean;
}

/** 校验并读出可投递的条目(文件不存在/读不了 → changed,出队)。 */
export function resolveDrainCandidates(entries: SpoolEntry[]): DrainCandidate[] {
  return entries.map((entry) => {
    try {
      const content = readFileText(entry.path);
      return { entry, content, changed: sha256(content) !== entry.hash };
    } catch {
      return { entry, content: '', changed: true };
    }
  });
}

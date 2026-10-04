/** 增量摄入清单: ~/.exomind/manifest.json,记录每个源文件的内容哈希。
 *  用于 exomind ingest --dir 跳过未变更文件,避免重复 LLM 抽取。 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { CONFIG_DIR } from './config';

const MANIFEST_FILE = path.join(CONFIG_DIR, 'manifest.json');
const LOCK_FILE = path.join(CONFIG_DIR, 'manifest.lock');

export interface FileRecord {
  hash: string;
  ingested_at: string;
  title: string;
  size: number;
  /** 'ok'(缺省)= 完整摄入;'degraded' = 原文已入库但实体抽取未完成,exomind backfill 补跑。 */
  status?: 'ok' | 'degraded';
}

/** 以文件绝对路径为 key。 */
export type Manifest = Record<string, FileRecord>;

export function sha256(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf-8').digest('hex');
}

export function loadManifest(): Manifest {
  try {
    const d = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf-8'));
    return d && typeof d === 'object' ? (d as Manifest) : {};
  } catch {
    return {};
  }
}

export function saveManifest(m: Manifest): void {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    // 原子写(tmp+rename):并发读(另一进程正 plan)不会读到半截 JSON
    const tmp = `${MANIFEST_FILE}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(m, null, 2));
    fs.renameSync(tmp, MANIFEST_FILE);
  } catch {
    /* 写入失败不阻塞主流程 */
  }
}

/** 记录一个文件已摄入(--file 与 --dir 共用,保证跨模式判重一致)。
 *  hash 用原始内容,与 planIngestest 的算法一致 → --file 摄过的文件,--dir 会跳过。 */
export function recordFile(
  manifest: Manifest,
  absPath: string,
  rawContent: string,
  title: string,
  status: 'ok' | 'degraded' = 'ok',
): void {
  manifest[absPath] = {
    hash: sha256(rawContent),
    ingested_at: new Date().toISOString(),
    title,
    size: rawContent.length,
    ...(status === 'ok' ? {} : { status }),
  };
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false; // ESRCH = 进程不存在(EPERM 在 macOS 上不会出现在此场景)
  }
}

/** 获取 manifest 互斥锁(尽力而为):防止两个 `ingest --dir` 并发跑时互相
 *  全量覆盖 ~/.exomind/manifest.json。
 *  - 持锁进程已死 → stale 锁直接抢占(锁文件记 pid,挂起到午夜的运行进程活着就不抢);
 *  - timeoutMs 内拿不到 → 返回 null,调用方降级为无锁运行(与旧行为一致,仅告警)。
 *  返回 release 函数,幂等。 */
export function acquireManifestLock(timeoutMs = 3000): (() => void) | null {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      const fd = fs.openSync(LOCK_FILE, 'wx');
      const release = (): void => {
        try {
          fs.unlinkSync(LOCK_FILE);
        } catch {
          /* 已被清理 */
        }
      };
      try {
        fs.writeSync(fd, String(process.pid));
      } finally {
        fs.closeSync(fd);
      }
      return release;
    } catch (e: any) {
      if (e?.code !== 'EEXIST') return null;
      try {
        const pid = Number(fs.readFileSync(LOCK_FILE, 'utf-8').trim());
        if (Number.isInteger(pid) && pid > 0 && pid !== process.pid && !pidAlive(pid)) {
          fs.unlinkSync(LOCK_FILE); // 持锁者已死 → 抢占重试
          continue;
        }
      } catch {
        /* 锁文件读不了 → 等下一轮 */
      }
      if (Date.now() >= deadline) return null;
      const wait = new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(wait, 0, 0, Math.min(100, deadline - Date.now())); // 同步小睡
    }
  }
}

/** 清理指定目录下已不存在的文件记录(只清该目录,不碰其它目录)。
 *  只按「文件是否仍存在」判断,与本次运行的 --pattern 无关——避免窄 pattern
 *  分批摄入时误删未被本批覆盖、但文件仍在的记录(2026-09-19 修复)。 */
export function cleanupStale(m: Manifest, dir: string): void {
  const prefix = path.resolve(dir) + path.sep;
  for (const key of Object.keys(m)) {
    if (key.startsWith(prefix) && !fs.existsSync(key)) {
      delete m[key];
    }
  }
}

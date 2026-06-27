/** 增量摄入清单: ~/.exomind/manifest.json,记录每个源文件的内容哈希。
 *  用于 exomind ingest --dir 跳过未变更文件,避免重复 LLM 抽取。 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { CONFIG_DIR } from './config';

const MANIFEST_FILE = path.join(CONFIG_DIR, 'manifest.json');

export interface FileRecord {
  hash: string;
  ingested_at: string;
  title: string;
  size: number;
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
    fs.writeFileSync(MANIFEST_FILE, JSON.stringify(m, null, 2));
  } catch {
    /* 写入失败不阻塞主流程 */
  }
}

/** 记录一个文件已摄入(--file 与 --dir 共用,保证跨模式判重一致)。
 *  hash 用原始内容,与 planIngestest 的算法一致 → --file 摄过的文件,--dir 会跳过。 */
export function recordFile(manifest: Manifest, absPath: string, rawContent: string, title: string): void {
  manifest[absPath] = {
    hash: sha256(rawContent),
    ingested_at: new Date().toISOString(),
    title,
    size: rawContent.length,
  };
}

/** 清理指定目录下已不存在的文件记录(只清该目录,不碰其它目录)。 */
export function cleanupStale(m: Manifest, dir: string, currentFiles: string[]): void {
  const prefix = path.resolve(dir) + path.sep;
  const current = new Set(currentFiles);
  for (const key of Object.keys(m)) {
    if (key.startsWith(prefix) && !current.has(key)) {
      delete m[key];
    }
  }
}

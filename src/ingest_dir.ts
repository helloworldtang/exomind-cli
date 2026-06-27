/** exomind ingest --dir: 目录批量 + 增量(内容哈希 manifest 去重)。
 *  模式参考 LlamaIndex refresh() / Haystack skip: 只对内容变更的文件调用 ingest。 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ApiClient } from './api';
import { opTimeout } from './api';
import { sha256, loadManifest, saveManifest, cleanupStale, recordFile, type Manifest } from './manifest';
import { readFileText } from './io';
import { output, green, red, dim } from './format';

export interface DirOpts {
  tag?: string[];
  recursive?: boolean;
  pattern?: string;
  force?: boolean;
}

/** 简单 glob → RegExp,仅用于文件名匹配(* → .*, ? → .)。 */
export function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

/** 遍历目录,返回匹配的文件绝对路径(已排序)。跳过隐藏文件/目录(.开头)。 */
export function walkDir(dir: string, recursive: boolean, pattern: string): string[] {
  const rx = globToRegex(pattern);
  const out: string[] = [];
  const walk = (d: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (recursive) walk(full);
      } else if (e.isFile() && rx.test(e.name)) {
        out.push(full);
      }
    }
  };
  walk(path.resolve(dir));
  return out.sort();
}

/** 从首个 H1 或文件名推导标题。 */
export function deriveTitle(file: string, content: string): string {
  for (const line of content.split('\n')) {
    const m = line.match(/^#\s+(.+?)\s*$/);
    if (m) return m[1].trim();
  }
  return path.basename(file).replace(/\.[^.]+$/, '');
}

export interface DirPlan {
  toIngest: { path: string; content: string; title: string; hash: string }[];
  toSkip: string[];
}

/** 读取文件并分类: hash 变了/新增/--force → 摄入;否则跳过。 */
export function planIngestest(files: string[], manifest: Manifest, force: boolean): DirPlan {
  const toIngest: DirPlan['toIngest'] = [];
  const toSkip: string[] = [];
  for (const f of files) {
    let content: string;
    try {
      content = readFileText(f);
    } catch {
      continue; // 读不了的文件跳过
    }
    const hash = sha256(content);
    const prev = manifest[f];
    if (!force && prev && prev.hash === hash) {
      toSkip.push(f);
    } else {
      toIngest.push({ path: f, content, title: deriveTitle(f, content), hash });
    }
  }
  return { toIngest, toSkip };
}

/** 执行目录增量摄入: 串行(弱服务器友好),每文件后保存 manifest(崩溃安全)。 */
export async function runDirIngestest(client: ApiClient, opts: DirOpts, dir: string): Promise<void> {
  const files = walkDir(dir, !!opts.recursive, opts.pattern || '*.md');
  if (!files.length) {
    console.log(dim(`目录 ${dir} 下无匹配文件。`));
    return;
  }

  const manifest = loadManifest();
  const plan = planIngestest(files, manifest, !!opts.force);
  const total = files.length;
  process.stderr.write(
    `目录 ${dir}: ${total} 文件 — 待摄入 ${plan.toIngest.length},跳过 ${plan.toSkip.length}\n`,
  );

  let added = 0;
  let updated = 0;
  let failed = 0;
  for (let i = 0; i < plan.toIngest.length; i++) {
    const f = plan.toIngest[i];
    const prev = manifest[f.path];
    process.stderr.write(`⏳ [${i + 1}/${plan.toIngest.length}] ${path.basename(f.path)}…\n`);
    try {
      const res = await client.post(
        '/ingest',
        { content: f.content, title: f.title, tags: opts.tag },
        { timeoutMs: opTimeout(300000) },
      );
      recordFile(manifest, f.path, f.content, f.title);
      saveManifest(manifest);
      if (prev) {
        updated++;
        process.stderr.write(`  ${green('✓')} 更新 — 实体 ${res.entities ?? 0}/概念 ${res.concepts ?? 0}\n`);
      } else {
        added++;
        process.stderr.write(`  ${green('✓')} 新增 — 实体 ${res.entities ?? 0}/概念 ${res.concepts ?? 0}\n`);
      }
    } catch (e) {
      failed++;
      process.stderr.write(`  ${red('✗')} ${(e as Error).message}\n`);
    }
  }

  cleanupStale(manifest, dir, files);
  saveManifest(manifest);

  const allUpToDate = added + updated === 0 && plan.toSkip.length > 0 && failed === 0;
  output(
    { added, updated, skipped: plan.toSkip.length, failed, total, dir, allUpToDate },
    () => {
      console.log(
        green('✓ 目录摄入完成') +
          dim(
            `: 新增 ${added} / 更新 ${updated} / 跳过 ${plan.toSkip.length} / 失败 ${failed} (共 ${total})`,
          ),
      );
      if (allUpToDate) {
        console.log(
          dim('（全部已是最新,无需重摄;除非用户明确要求强制刷新,否则不要加 --force）'),
        );
      }
    },
  );
}

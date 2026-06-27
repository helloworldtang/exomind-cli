/** exomind ingest — 导入知识。支持参数 / stdin / 文件。 */
import * as path from 'node:path';
import { opTimeout, type ApiClient } from '../api';
import { output, ok, green, dim, truncate, hint } from '../format';
import { readStdin, readStdinForced, readFileText } from '../io';
import { runDirIngestest } from '../ingest_dir';
import { loadManifest, saveManifest, recordFile } from '../manifest';

export default async function ingest(
  client: ApiClient,
  opts: {
    title?: string;
    tag?: string[];
    file?: string;
    dir?: string;
    recursive?: boolean;
    pattern?: string;
    force?: boolean;
  },
  args: string[],
): Promise<void> {
  if (opts.dir) return runDirIngestest(client, opts, opts.dir);

  let content = '';
  let fileAbs: string | null = null;
  let fileRaw: string | null = null;
  if (opts.file) {
    fileRaw = readFileText(opts.file);
    content = fileRaw;
    fileAbs = path.resolve(opts.file);
  } else if (args.length && args[0] === '-') {
    content = await readStdinForced();
  } else if (args.length) {
    content = args.join(' ');
  } else {
    content = await readStdin();
  }

  content = content.trim();
  if (!content) {
    throw new Error('内容为空。用法: exomind ingest "文本" | --file <路径> | echo ... | exomind ingest');
  }
  if (content.length > 50000) {
    throw new Error(`内容过长(${content.length} 字符),上限 50000`);
  }

  const body: Record<string, unknown> = { content };
  if (opts.title) body.title = opts.title;
  if (opts.tag && opts.tag.length) body.tags = opts.tag;

  hint('⏳ 摄入中: 服务器用 LLM 抽取实体/关系,长内容可能 1-3 分钟…');
  const result = await client.post('/ingest', body, { timeoutMs: opTimeout(300000) });

  // --file 摄入记录 manifest(与 --dir 共用同一份,保证跨模式判重:--file 摄过的文件,--dir 会跳过)
  if (fileAbs && fileRaw !== null) {
    const man = loadManifest();
    recordFile(man, fileAbs, fileRaw, opts.title || path.basename(fileAbs));
    saveManifest(man);
  }

  output(result, () => {
    console.log(ok('已导入服务器知识库'));
    if (opts.title) console.log(dim(`  标题: ${opts.title}`));
    console.log(`  ${green('实体')}: ${result.entities ?? 0}   ${green('概念')}: ${result.concepts ?? 0}`);
    if (result.summary) console.log(dim(`  摘要: ${truncate(result.summary, 120)}`));
    if (result.created_pages?.length) {
      console.log(`  ${dim('新建页面')}: ${result.created_pages.map((p: string) => truncate(p, 60)).join(', ')}`);
    }
    if (result.updated_pages?.length) {
      console.log(`  ${dim('更新页面')}: ${result.updated_pages.map((p: string) => truncate(p, 60)).join(', ')}`);
    }
  });
}

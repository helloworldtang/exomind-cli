/**
 * exomind — ExoMind 跨平台命令行客户端。
 * 通过 REST 与 ExoMind 知识库交互,替代 Windows 不可用的 MCP 客户端。
 */
import { Command } from 'commander';
import pkg from '../package.json' assert { type: 'json' };
import { ApiClient, ApiError } from './api';
import { resolveConfig } from './config';
import { setJsonMode, isJsonMode, red } from './format';
import { runHook } from './hook';

import ingest from './commands/ingest';
import query from './commands/query';
import search from './commands/search';
import entity from './commands/entity';
import relations from './commands/relations';
import stats from './commands/stats';
import { list as reviewList, mark as reviewMark } from './commands/review';
import synthesize from './commands/synthesize';
import topics from './commands/topics';
import gaps from './commands/gaps';
import feedback from './commands/feedback';
import daily from './commands/daily';
import login from './commands/login';
import whoami from './commands/whoami';
import installCmd from './commands/install';

const VERSION = pkg.version;

type AnyOpts = Record<string, unknown>;

function collect(value: string, previous: string[]): string[] {
  return [...(previous ?? []), value];
}

function toInt(v: unknown): number {
  const n = parseInt(String(v), 10);
  if (Number.isNaN(n)) throw new Error(`期望整数,得到: ${v}`);
  return n;
}

/** 走到根 program 读取全局选项(--json/--base-url/--api-key)。 */
function rootOptions(cmd: Command): AnyOpts {
  let c: Command = cmd;
  while (c.parent) c = c.parent;
  return c.opts();
}

function handleError(e: unknown): never {
  const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
  if (isJsonMode()) {
    console.log(JSON.stringify({ error: msg }));
  } else {
    console.error(red(`✗ ${msg}`));
  }
  process.exit(1);
}

/** 包装命令 action: 构建客户端 + 设置 json 模式 + 统一错误处理。 */
function run<T = AnyOpts>(fn: (client: ApiClient, opts: T, args: string[]) => Promise<void>) {
  return async (...a: unknown[]): Promise<void> => {
    const command = a[a.length - 1] as Command;
    const root = rootOptions(command);
    setJsonMode(!!root.json);
    const cfg = resolveConfig({ baseUrl: root.baseUrl as string | undefined, apiKey: root.apiKey as string | undefined });
    const client = new ApiClient(cfg);
    try {
      await fn(client, command.opts() as T, command.args);
    } catch (e) {
      handleError(e);
    }
  };
}

const program = new Command();

program
  .name('exomind')
  .description('ExoMind 跨平台知识库客户端 — 通过 REST 交互(替代 Windows MCP 客户端)。')
  .version(VERSION)
  .option('--json', '输出原始 JSON(机器可读)')
  .option('--base-url <url>', '覆盖服务器地址')
  .option('--api-key <key>', '覆盖 API Key / 凭证');

// ── 登录 / 状态 ──
program
  .command('login')
  .description('配置服务器地址与凭证,写入 ~/.exomind/config.json')
  .option('--base-url <url>', '服务器地址')
  .option('--api-key <key>', 'API Key 或登录 token(不填则交互输入)')
  .action(run(login));

program
  .command('whoami')
  .description('显示当前登录态与服务器')
  .action(run(whoami));

// ── 写入 ──
program
  .command('ingest [content...]')
  .description('导入知识: 参数文本 / --file / stdin / --dir 目录批量(增量)')
  .option('-t, --title <title>', '标题(单文件模式)')
  .option('--tag <tag>', '标签(可重复)', collect, [])
  .option('--file <path>', '从文件读取内容')
  .option('--dir <path>', '目录批量摄入(增量: 内容哈希跳过未变文件)')
  .option('-r, --recursive', '递归子目录(配合 --dir)')
  .option('--pattern <glob>', '文件名匹配,默认 *.md', '*.md')
  .option('--force', '忽略 manifest,强制全量重摄(配合 --dir)')
  .action(run(ingest));

// ── 查询 ──
program
  .command('query [question...]')
  .description('LLM 问答')
  .option('--tag <tag>', '标签过滤(可重复)', collect, [])
  .option('--model <name>', '模型')
  .action(run(query));

program
  .command('search [keyword...]')
  .description('全文/混合/精排搜索')
  .option('-l, --limit <n>', '返回数量', '10')
  .option('--rerank', 'LLM 精排(更准但更慢)')
  .option('--hybrid', '混合搜索(BM25+语义)')
  .action(run(search));

program
  .command('entity [name...]')
  .description('实体详情 + 关系')
  .action(run(entity));

program
  .command('relations [name...]')
  .description('关联实体(可达性)')
  .option('-d, --depth <n>', '搜索深度 1-3', '1')
  .action(run(relations));

program
  .command('stats')
  .description('知识库统计')
  .action(run(stats));

// ── 复习 ──
const reviewCmd = program
  .command('review')
  .description('FSRS-5 复习队列')
  .option('-l, --limit <n>', '数量', '12');
reviewCmd.action(run((client, opts: AnyOpts) => reviewList(client, { limit: toInt(opts.limit) })));
reviewCmd
  .command('mark [name...]')
  .description('标记复习 (rating: 1=忘记 2=吃力 3=顺利 4=轻松)')
  .option('-r, --rating <n>', '1-4', '3')
  .action(run((client, opts: AnyOpts, args) => reviewMark(client, { rating: toInt(opts.rating) }, args)));

// ── 洞察 ──
program
  .command('synthesize [topic...]')
  .description('主题综合报告')
  .option('-d, --depth <n>', '深度 1-5', '2')
  .action(run(synthesize));

program
  .command('topics')
  .description('选题推荐')
  .option('-c, --count <n>', '数量', '5')
  .action(run((client, opts: AnyOpts) => topics(client, { count: toInt(opts.count) })));

program
  .command('gaps')
  .description('知识缺口(被多次搜索但无结果)')
  .option('-d, --days <n>', '回溯天数', '30')
  .action(run((client, opts: AnyOpts) => gaps(client, { days: toInt(opts.days) })));

program
  .command('feedback [page...]')
  .description('对页面/实体打反馈 (positive|negative)')
  .action(run(feedback));

program
  .command('daily')
  .description('每日活动摘要')
  .option('-d, --days <n>', '回溯天数', '1')
  .action(run((client, opts: AnyOpts) => daily(client, { days: toInt(opts.days) })));

// ── 钩子(跨平台,替代 exomind-context.sh)──
program
  .command('hook')
  .description('UserPromptSubmit 钩子(由 Claude Code 调用,非手动)')
  .action(async (...a: unknown[]) => {
    const command = a[a.length - 1] as Command;
    const root = rootOptions(command);
    setJsonMode(false);
    const cfg = resolveConfig({ baseUrl: root.baseUrl as string | undefined, apiKey: root.apiKey as string | undefined });
    const client = new ApiClient(cfg);
    try {
      await runHook(client);
    } catch (e) {
      // 钩子失败绝不阻塞用户的 prompt
      process.stderr.write(`[exomind hook] ${e instanceof Error ? e.message : String(e)}\n`);
    }
    process.exit(0);
  });

// ── 安装 skill + hook ──
program
  .command('install')
  .description('安装 Claude Code skill(可选 --with-hook 写入 UserPromptSubmit)')
  .option('--with-hook', '同时写入 ~/.claude/settings.json 的 hook')
  .action(run(installCmd));

async function main(): Promise<void> {
  await program.parseAsync(process.argv);
}

main().catch((e) => handleError(e));

/**
 * 文档里的命令示例必须真的能跑。
 *
 * 起因：6 处文档（本仓 `docs/cli-guide.md` 2 处 + 服务端仓 `README.md` /
 * `docs/new-machine-setup.md` / `docs/jdit-flow.md` 4 处）写的是
 * `exomind install --with-hook`，而**这个选项根本不存在** —— 真 CLI 报
 * `error: unknown option '--with-hook'`（hook 本来就默认写，只有 `--no-hook` 才跳过）。
 *
 * 同类前科：landing 页写 `exomind ingest <目录> --dir`，而 `--dir` 是取值型
 * （`--dir <path>`）→ `error: option '--dir <path>' argument missing`。
 *
 * 共同点：**不报错、不测试、只有真人复制粘贴时才炸**。而文档正是用户最先读的东西。
 *
 * 真值取自 `src/cli.ts`（不是手写清单），所以 CLI 改了选项，这里会自动跟着变。
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

interface CliSurface {
  subcommands: Set<string>;
  valueFlags: Set<string>;
  boolFlags: Set<string>;
}

/** 从 cli.ts 解析出子命令与选项真值。 */
function parseCliSurface(): CliSurface {
  const src = readFileSync(join(ROOT, 'src', 'cli.ts'), 'utf8');

  const subcommands = new Set<string>();
  for (const m of src.matchAll(/\.command\(\s*'([a-z]+)/g)) subcommands.add(m[1]);

  const valueFlags = new Set<string>();
  const boolFlags = new Set<string>();
  for (const m of src.matchAll(/\.(?:option|requiredOption)\(\s*'([^']+)'/gs)) {
    const long = m[1]
      .split(',')
      .map((s) => s.trim())
      .find((s) => s.startsWith('--'));
    if (!long) continue;
    const name = long.split(/\s+/)[0];
    (long.includes('<') ? valueFlags : boolFlags).add(name);
  }
  return { subcommands, valueFlags, boolFlags };
}

function walkMd(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkMd(p));
    else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

/**
 * 取「会被复制走」的 `exomind ...` 行：围栏代码块 + 表格行。
 * 刻意不取散文段落 —— 正文里 `` `exomind install` 默认会… `` 是叙述，
 * 当成命令解析会把中文句子当参数。
 *
 * 另需排除**架构图**：README 里有
 * `exomind CLI  ──HTTPS REST (Bearer)──▶  ExoMind 服务器`
 * 这种行，它也在围栏里、也以 `exomind` 开头，但不是命令（`CLI` 不是子命令）。
 * 判据是出现制表/箭头字符。
 */
const DIAGRAM_CHARS = /[─│┌└┐┘├┤┬┴┼▶◀→←↔━┃╱╲]/;

function collectExamples(): Array<{ file: string; line: number; raw: string }> {
  const files = [join(ROOT, 'README.md'), join(ROOT, 'CLAUDE.md'), ...walkMd(join(ROOT, 'docs')), ...walkMd(join(ROOT, 'skill'))];
  const out: Array<{ file: string; line: number; raw: string }> = [];

  for (const f of files) {
    if (!existsSync(f)) continue;
    let inFence = false;
    readFileSync(f, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        const stripped = line.trim();
        if (stripped.startsWith('```')) {
          inFence = !inFence;
          return;
        }
        if (!inFence && !stripped.startsWith('|')) return;
        if (DIAGRAM_CHARS.test(line)) return; // 架构图，不是命令
        const m = /^\s*(?:\$\s*)?\|?\s*`?\s*((?:exomind|emcli)\s+\S.*)$/.exec(line);
        if (!m) return;
        const raw = m[1]
          .replace(/[|`]+$/, '')
          .replace(/`/g, '')
          .replace(/[[\]]/g, '');
        out.push({ file: relative(ROOT, f), line: i + 1, raw });
      });
  }
  return out;
}

/** 极简 shell 分词：够用即可（去注释、识别引号）。 */
function tokenize(line: string): string[] {
  const noComment = line.replace(/\s#.*$/, '');
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const m of noComment.matchAll(re)) tokens.push(m[1] ?? m[2] ?? m[3]);
  return tokens;
}

describe('文档里的命令示例', () => {
  const surface = parseCliSurface();

  test('能从 cli.ts 解析出真值（否则下面的断言会退化成空断言）', () => {
    assert.ok(surface.subcommands.size >= 15, `只解析到 ${surface.subcommands.size} 个子命令`);
    assert.ok(surface.valueFlags.size >= 15, `只解析到 ${surface.valueFlags.size} 个取值型选项`);
    assert.ok(surface.boolFlags.size >= 5, `只解析到 ${surface.boolFlags.size} 个布尔型选项`);
  });

  test('示例提取有效（数量下限，防正则失配后退化成空断言）', () => {
    const examples = collectExamples();
    assert.ok(examples.length >= 30, `只提取到 ${examples.length} 条示例，疑似提取逻辑失效`);
  });

  test('每条示例的子命令与选项都必须存在，取值型选项必须有值', () => {
    const allFlags = new Set([...surface.valueFlags, ...surface.boolFlags]);
    const problems: string[] = [];

    for (const { file, line, raw } of collectExamples()) {
      const tokens = tokenize(raw);
      if (!['exomind', 'emcli'].includes(tokens[0]) || tokens.length < 2) continue;
      if (tokens[1].startsWith('-')) continue; // 如 `exomind --help`

      if (!surface.subcommands.has(tokens[1])) {
        problems.push(`${file}:${line} 子命令不存在 \`${tokens[1]}\` → ${raw}`);
        continue;
      }
      tokens.forEach((tok, i) => {
        if (!tok.startsWith('--')) return;
        const flag = tok.split('=')[0];
        if (!allFlags.has(flag)) {
          problems.push(
            `${file}:${line} 选项不存在 \`${flag}\`（真 CLI 会报 unknown option）→ ${raw}`,
          );
          return;
        }
        if (surface.valueFlags.has(flag) && !tok.includes('=')) {
          const next = tokens[i + 1];
          if (next === undefined || next.startsWith('-')) {
            problems.push(
              `${file}:${line} 取值型选项 \`${flag}\` 缺值（真 CLI 会报 argument missing）→ ${raw}`,
            );
          }
        }
      });
    }

    assert.deepEqual(problems, [], `文档里有 ${problems.length} 条示例跑不通：\n${problems.join('\n')}`);
  });
});

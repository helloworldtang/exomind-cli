/**
 * 命令别名契约: `archive` 是 `ingest` 的别名。
 *
 * 起因: 给外部 Agent(workbuddy/qclaw 等)下"用 emcli 存档"指令时,它们的第一
 * 反应是 `emcli archive`;原名不存在就会走一轮"猜错→报错→推理改口"的弯路。
 * 别名在 CLI 层终结这条弯路,不依赖对方是否装了 exomind skill。
 * 本测试锁住别名注册与 README 说明,防止重构时无声丢失。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 经 tsx 直接跑 src/cli.ts(不走 dist,不依赖构建,不打网络——只用 --help)。 */
function runCli(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  return spawnSync('node', ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), ...args], {
    encoding: 'utf-8',
    timeout: 60000,
  });
}

describe('命令别名 (archive → ingest)', () => {
  test('emcli archive --help 解析到 ingest 并标注别名', () => {
    const r = runCli('archive', '--help');
    assert.equal(r.status, 0, r.stderr);
    // commander 12 把别名并排渲染在 usage 行: "Usage: exomind ingest|archive ..."
    assert.match(r.stdout, /Usage: \S+ ingest\|archive/, 'usage 应并列 ingest|archive');
  });

  test('cli.ts 为 ingest 注册 archive 别名', () => {
    const src = readFileSync(join(ROOT, 'src', 'cli.ts'), 'utf8');
    assert.match(src, /\.alias\('archive'\)/);
  });

  test('README 说明 archive 别名', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
    assert.match(readme, /archive/, 'README 应提到 archive 别名');
  });
});

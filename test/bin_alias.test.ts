/**
 * bin 双名契约: `exomind` 与 `emcli` 必须同时可用且指向同一入口。
 *
 * 起因: emcli 是用户日常省敲的短名,而它只在 package.json 的 bin 字段里声明——
 * 没有任何代码引用它。若重构时 bin 被改回单名(或 emcli 指到别的文件),
 * 不报错、不测试,只有用户敲 `emcli` 时才 command not found。
 * 同理 cli.ts 的 help/usage 跟随调用名逻辑、README 的别名说明,也一并锁住。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('bin 双名 (exomind / emcli)', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

  test('bin 同时声明 exomind 与 emcli,指向同一入口', () => {
    assert.equal(pkg.bin?.exomind, 'dist/cli.js');
    assert.equal(pkg.bin?.emcli, 'dist/cli.js');
  });

  test('cli.ts 的 help/usage 跟随实际调用名(emcli 时显示 emcli)', () => {
    const src = readFileSync(join(ROOT, 'src', 'cli.ts'), 'utf8');
    assert.match(src, /endsWith\('\/emcli'\)/, 'cli.ts 应按 argv[1] 识别 emcli 调用');
    assert.match(src, /\.name\(binName\)/, 'program.name 应使用动态 binName');
  });

  test('README 说明 emcli 别名', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
    assert.match(readme, /emcli/, 'README 应提到 emcli 短命令');
  });
});

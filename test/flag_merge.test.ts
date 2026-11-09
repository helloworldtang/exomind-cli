/** 子命令同名旗标不被 root 截走的回归测试。
 *
 * commander 12 行为: root 与子命令定义同名旗标(--api-key/--base-url)时,
 * 出现在子命令后的值会被 root 解析走,command.opts() 拿不到——`login --api-key`
 * 脚本化登录曾因此被吞(智能登录早返回掩盖了它)。修复在 cli.ts run() 包装层
 * 合并 root 选项。本测试走真实 CLI 入口(tsx 子进程)锁行为。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('login --api-key 直传不被 root 旗标截走(脚本化登录回归)', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'exomind-flag-'));
  const env = { ...process.env, HOME: tmp, USERPROFILE: tmp };
  delete env.EXOMIND_API_KEY;
  delete env.EXOMIND_BASE_URL;
  // 127.0.0.1:9 立即拒连:login 走「无法校验仍保存」分支,不打真网
  const r = spawnSync(
    'node',
    ['--import', 'tsx', join(ROOT, 'src', 'cli.ts'), 'login', '--api-key', 'sk_flag_probe', '--base-url', 'http://127.0.0.1:9'],
    { encoding: 'utf-8', timeout: 60000, env },
  );
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.stdout.includes('登录成功'), r.stdout);
  const cfg = JSON.parse(readFileSync(path.join(tmp, '.exomind', 'config.json'), 'utf-8'));
  assert.equal(cfg.api_key, 'sk_flag_probe');
  assert.equal(cfg.base_url, 'http://127.0.0.1:9');
});

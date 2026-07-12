/**
 * 协议级 e2e: 对真实 ExoMind 服务器跑只读命令,验证 CLI ↔ REST 协议兼容。
 *
 * 设计原则: CLI 与服务端通过协议解耦,本测试只依赖"协议",不依赖服务端仓库的任何文件。
 * 默认跳过(纯单元测试即可);设置 EXOMIND_API_KEY 后才运行,打真实服务器(只读)。
 *
 * 运行: EXOMIND_API_KEY=sk_xxx npm test   (或 CI 注入)
 * 默认: npm test                          (本测试 skip)
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';

const KEY = process.env.EXOMIND_API_KEY;
const BASE = process.env.EXOMIND_BASE_URL || 'https://youhuale.cn';
const DIST = path.resolve(process.cwd(), 'dist', 'cli.js');

const skipReason: string | false = !KEY
  ? '未设置 EXOMIND_API_KEY (默认跳过)'
  : !fs.existsSync(DIST)
    ? 'dist/cli.js 未构建 (先 npm run build)'
    : false;

function cli(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  return spawnSync('node', [DIST, '--base-url', BASE, '--api-key', KEY as string, '--json', ...args], {
    encoding: 'utf-8',
    timeout: 30000,
  });
}

describe('e2e: 对真实服务器 (协议级, 只读)', { skip: skipReason }, () => {
  test('stats 返回统计对象', () => {
    const r = cli('stats');
    assert.equal(r.status, 0, r.stderr);
    const data = JSON.parse(r.stdout);
    assert.equal(typeof data.total_nodes, 'number');
    assert.ok(data.total_nodes > 0);
  });

  test('search 返回结果数组', () => {
    const r = cli('search', 'Redis', '--limit', '3');
    assert.equal(r.status, 0, r.stderr);
    const data = JSON.parse(r.stdout);
    assert.ok(Array.isArray(data.results));
    assert.ok(data.results.length > 0);
  });

  test('entity 返回指定实体', () => {
    const r = cli('entity', 'Redis');
    assert.equal(r.status, 0, r.stderr);
    const data = JSON.parse(r.stdout);
    assert.equal(data.name, 'Redis');
  });
});

import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

type Mod = typeof import('../src/ingest_dir');
let id!: Mod;
before(async () => {
  id = await import('../src/ingest_dir');
});

describe('ingest_dir', () => {
  test('globToRegex', () => {
    assert.ok(id.globToRegex('*.md').test('a.md'));
    assert.ok(id.globToRegex('*.md').test('a.b.md'));
    assert.ok(!id.globToRegex('*.md').test('a.txt'));
  });

  test('deriveTitle: H1 优先,否则文件名', () => {
    assert.equal(id.deriveTitle('/x/foo.md', '# Foo 标题\n正文'), 'Foo 标题');
    assert.equal(id.deriveTitle('/x/bar.md', '无标题'), 'bar');
  });

  test('walkDir: 匹配 + 递归 + 跳过隐藏', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exo-walk-'));
    fs.writeFileSync(path.join(dir, 'a.md'), '# A');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'x');
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'sub', 'c.md'), '# C');
    fs.mkdirSync(path.join(dir, '.git'));
    fs.writeFileSync(path.join(dir, '.git', 'd.md'), '隐藏');

    const flat = id.walkDir(dir, false, '*.md');
    assert.deepEqual(
      flat.map((p) => path.basename(p)),
      ['a.md'],
    );
    const rec = id.walkDir(dir, true, '*.md');
    assert.deepEqual(
      rec.map((p) => path.basename(p)),
      ['a.md', 'c.md'],
    ); // .git/d.md 被跳过
  });

  test('planIngestest: 新增 → 跳过 → 内容变更 → 更新 → --force', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exo-plan-'));
    const fa = path.join(dir, 'a.md');
    const fb = path.join(dir, 'b.md');
    fs.writeFileSync(fa, 'content A');
    fs.writeFileSync(fb, 'content B');

    // 首次:两个都新增
    let plan = id.planIngestest([fa, fb], {}, false);
    assert.equal(plan.toIngest.length, 2);
    assert.equal(plan.toSkip.length, 0);

    // 记录 a 的 hash(模拟已摄入)
    const manA = {
      [fa]: { hash: plan.toIngest[0].hash, ingested_at: '', title: 'a', size: 9 },
    };
    plan = id.planIngestest([fa, fb], manA, false);
    assert.equal(plan.toSkip.length, 1); // a 跳过
    assert.equal(plan.toIngest.length, 1); // b 新增

    // a 内容变了 → hash 不同 → 进入 toIngest(更新)
    fs.writeFileSync(fa, 'content A CHANGED');
    plan = id.planIngestest([fa, fb], manA, false);
    assert.equal(plan.toIngest.length, 2);

    // --force → 全部摄入
    plan = id.planIngestest([fa, fb], manA, true);
    assert.equal(plan.toIngest.length, 2);
    assert.equal(plan.toSkip.length, 0);
  });
});

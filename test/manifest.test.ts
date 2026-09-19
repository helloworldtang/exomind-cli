import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// HOME 指向临时目录,隔离 ~/.exomind/manifest.json
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'exomind-man-'));
process.env.HOME = TMP;
process.env.USERPROFILE = TMP;

type Mod = typeof import('../src/manifest');
let m!: Mod;
before(async () => {
  m = await import('../src/manifest');
});

describe('manifest', () => {
  test('sha256 确定性 + 已知值', () => {
    assert.equal(m.sha256('hello'), m.sha256('hello'));
    assert.notEqual(m.sha256('a'), m.sha256('b'));
    assert.equal(
      m.sha256('hello'),
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  test('save → load 往返', () => {
    fs.rmSync(path.join(TMP, '.exomind'), { recursive: true, force: true });
    const man = { '/tmp/a.md': { hash: 'h1', ingested_at: 't', title: 'A', size: 10 } };
    m.saveManifest(man);
    assert.deepEqual(m.loadManifest(), man);
  });

  test('loadManifest 无文件时返回空对象', () => {
    fs.rmSync(path.join(TMP, '.exomind'), { recursive: true, force: true });
    assert.deepEqual(m.loadManifest(), {});
  });

  test('cleanupStale 只清「文件已不存在」的记录,不碰其它目录与仍在文件', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'exomind-clean-'));
    const dir = path.join(root, 'dir');
    fs.mkdirSync(dir, { recursive: true });
    const keepA = path.join(dir, 'a.md'); // 仍在 + 本批覆盖
    const keepB = path.join(dir, 'b.md'); // 仍在 + 本批未覆盖（回归：不再被误删）
    const goneC = path.join(dir, 'c.md'); // 已删除 → 应清
    const otherD = path.join(root, 'd.md'); // 其它目录 → 不动
    fs.writeFileSync(keepA, 'a');
    fs.writeFileSync(keepB, 'b');
    fs.writeFileSync(otherD, 'd');
    const rec = (h: string) => ({ hash: h, ingested_at: '', title: h, size: 1 });
    const man: Record<string, { hash: string; ingested_at: string; title: string; size: number }> = {
      [keepA]: rec('1'),
      [keepB]: rec('2'),
      [goneC]: rec('3'),
      [otherD]: rec('4'),
    };
    m.cleanupStale(man, dir);
    assert.ok(keepA in man);
    assert.ok(keepB in man); // 文件仍在 → 即使不在本批名单也不清（修复点）
    assert.ok(!(goneC in man)); // 文件已不存在 → 清掉
    assert.ok(otherD in man); // 其它目录不动
    fs.rmSync(root, { recursive: true, force: true });
  });
});

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

  test('cleanupStale 只清指定目录的失效记录,不碰其它目录', () => {
    const man = {
      '/data/dir/a.md': { hash: '1', ingested_at: '', title: 'A', size: 1 },
      '/data/dir/b.md': { hash: '2', ingested_at: '', title: 'B', size: 1 },
      '/other/c.md': { hash: '3', ingested_at: '', title: 'C', size: 1 },
    };
    m.cleanupStale(man, '/data/dir', ['/data/dir/a.md']);
    assert.ok('/data/dir/a.md' in man);
    assert.ok(!('/data/dir/b.md' in man)); // b 已删 → 清掉
    assert.ok('/other/c.md' in man); // 其它目录不动
  });
});

import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// HOME 指向临时目录,隔离 ~/.exomind/spool/(必须在 import src 前求值)
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'exomind-spool-'));
process.env.HOME = TMP;
process.env.USERPROFILE = TMP;

type Mod = typeof import('../src/spool');
let s!: Mod;
let sha256: (s: string) => string;
before(async () => {
  s = await import('../src/spool');
  ({ sha256 } = await import('../src/manifest'));
});

describe('spool(离线补投队列)', () => {
  test('入队 → 加载往返;同内容(hash)幂等覆盖', () => {
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.mkdirSync(TMP, { recursive: true });
    s.spoolEntry({ path: '/tmp/a.md', hash: 'h1', title: 'A', tags: ['x'], queued_at: 't' });
    s.spoolEntry({ path: '/tmp/b.md', hash: 'h2', title: 'B', queued_at: 't' });
    let all = s.loadSpool();
    assert.equal(all.length, 2);
    assert.ok(all.some((e) => e.path === '/tmp/a.md' && e.tags?.[0] === 'x'));

    // 同 hash 重复入队不膨胀
    s.spoolEntry({ path: '/tmp/a.md', hash: 'h1', title: 'A2', queued_at: 't2' });
    all = s.loadSpool();
    assert.equal(all.length, 2);
    assert.equal(all.find((e) => e.hash === 'h1')?.title, 'A2');
  });

  test('removeSpooled 出队;空目录返回 []', () => {
    s.removeSpooled('h1');
    assert.equal(s.loadSpool().length, 1);
    s.removeSpooled('h1'); // 幂等
    s.removeSpooled('h2');
    assert.deepEqual(s.loadSpool(), []);
    fs.rmSync(path.join(TMP, '.exomind', 'spool'), { recursive: true, force: true });
    assert.deepEqual(s.loadSpool(), []);
  });

  test('resolveDrainCandidates: 内容未变可投;已变/缺失出队', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exo-drain-'));
    const same = path.join(dir, 'same.md');
    const changed = path.join(dir, 'changed.md');
    const gone = path.join(dir, 'gone.md');
    const c1 = 'same content';
    fs.writeFileSync(same, c1);
    fs.writeFileSync(changed, 'v1');
    const entries = [
      { path: same, hash: sha256(c1), title: 'same', queued_at: '' },
      { path: changed, hash: sha256('v0'), title: 'changed', queued_at: '' },
      { path: gone, hash: sha256('x'), title: 'gone', queued_at: '' },
    ];
    const out = s.resolveDrainCandidates(entries);
    assert.equal(out.length, 3);
    assert.equal(out[0].changed, false);
    assert.equal(out[0].content, c1);
    assert.equal(out[1].changed, true); // 内容已变
    assert.equal(out[2].changed, true); // 文件不存在
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

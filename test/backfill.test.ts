import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'exomind-bf-'));
process.env.HOME = TMP;
process.env.USERPROFILE = TMP;

type Mod = typeof import('../src/commands/backfill');
let bf!: Mod;
let sha256: (s: string) => string;
type Man = typeof import('../src/manifest');
let man!: Man;
before(async () => {
  bf = await import('../src/commands/backfill');
  ({ sha256 } = await import('../src/manifest'));
  man = await import('../src/manifest');
});

describe('backfill: selectBackfill', () => {
  test('只挑 degraded;ok 记录、内容变更、文件缺失分别处理', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exo-bf-'));
    const ok = path.join(dir, 'ok.md');
    const deg = path.join(dir, 'deg.md');
    const degChanged = path.join(dir, 'deg-changed.md');
    const degGone = path.join(dir, 'deg-gone.md');
    const other = path.join(dir, 'other', 'deg2.md'); // --dir 过滤外
    fs.mkdirSync(path.join(dir, 'other'), { recursive: true });
    const cDeg = '# D\n待补';
    fs.writeFileSync(ok, 'ok');
    fs.writeFileSync(deg, cDeg);
    fs.writeFileSync(degChanged, 'v2'); // 记录的是 v1 的 hash
    fs.writeFileSync(other, 'o');
    const rec = (hash: string, status?: 'degraded') => ({
      hash, ingested_at: '', title: hash.slice(0, 4), size: 1, ...(status ? { status } : {}),
    });
    const m: man.Manifest = {
      [ok]: rec(sha256('ok')),
      [deg]: rec(sha256(cDeg), 'degraded'),
      [degChanged]: rec(sha256('v1'), 'degraded'),
      [degGone]: rec(sha256('x'), 'degraded'),
      [other]: rec(sha256('o'), 'degraded'),
    };

    // 全库:deg 与 other 可补,degChanged/degGone 跳过,ok/无标记不选
    const all = bf.selectBackfill(m);
    assert.deepEqual(all.items.map((i) => i.path), [deg, other]);
    assert.deepEqual(all.changed, [degChanged]);
    assert.deepEqual(all.gone, [degGone]);

    // --dir 限定:other 目录外的不选
    const scoped = bf.selectBackfill(m, path.join(dir, 'other'));
    assert.deepEqual(scoped.items.map((i) => i.path), [other]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

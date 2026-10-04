/** drain 回归: manifest 记录与 spool 条目的出队判定。
 *  曾有 bug: backfill 场景入队的条目在 manifest 有同 hash 的 degraded 记录,
 *  被误判「期间已摄入成功」直接出队,补跑丢失。 */
import './_setup_cache';
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'exomind-drain-'));
process.env.HOME = TMP;
process.env.USERPROFILE = TMP;

type Mod = typeof import('../src/commands/drain');
let drain!: Mod;
let sha256: (s: string) => string;
type Man = typeof import('../src/manifest');
let man!: Man;
type Sp = typeof import('../src/spool');
let sp!: Sp;
before(async () => {
  drain = (await import('../src/commands/drain')).default;
  ({ sha256 } = await import('../src/manifest'));
  man = await import('../src/manifest');
  sp = await import('../src/spool');
});

describe('drain', () => {
  test('manifest 有同 hash 的 degraded 记录 → 仍投递(不误杀 backfill 场景的补跑)', async () => {
    fs.rmSync(path.join(TMP, '.exomind'), { recursive: true, force: true });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exo-drain1-'));
    const f = path.join(dir, 'a.md');
    const content = '# A\n内容';
    fs.writeFileSync(f, content);
    const h = sha256(content);
    man.saveManifest({ [f]: { hash: h, ingested_at: '', title: 'a', size: content.length, status: 'degraded' } });
    sp.spoolEntry({ path: f, hash: h, title: 'a', queued_at: '' });

    let posted = 0;
    const client = {
      post: async () => {
        posted++;
        return { job_id: posted };
      },
      get: async () => ({ status: 'done', entities: 1, concepts: 0 }),
    };
    await drain(client as any, {});
    assert.equal(posted, 1, 'degraded 记录不算已成功,条目必须投递');
    assert.deepEqual(sp.loadSpool(), [], '投递成功后出队');
    const rec = man.loadManifest()[f];
    assert.equal(rec.hash, h);
    assert.notEqual(rec.status, 'degraded', '重抽取成功后标记回写');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('manifest 有同 hash 的成功记录 → 直接出队,不重复投递', async () => {
    fs.rmSync(path.join(TMP, '.exomind'), { recursive: true, force: true });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exo-drain2-'));
    const f = path.join(dir, 'b.md');
    const content = '# B\n内容';
    fs.writeFileSync(f, content);
    const h = sha256(content);
    man.saveManifest({ [f]: { hash: h, ingested_at: '', title: 'b', size: content.length } });
    sp.spoolEntry({ path: f, hash: h, title: 'b', queued_at: '' });

    let posted = 0;
    const client = {
      post: async () => {
        posted++;
        return { job_id: posted };
      },
      get: async () => ({ status: 'done' }),
    };
    await drain(client as any, {});
    assert.equal(posted, 0, '期间已成功摄入 → 出队不投');
    assert.deepEqual(sp.loadSpool(), []);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

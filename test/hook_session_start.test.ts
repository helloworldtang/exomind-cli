/** P3 handoff 读出侧 + 项目身份键回归。HOME 隔离——会写 cache 标记。 */
import './_setup_cache';
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ApiError } from '../src/api';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'exomind-ss-'));
process.env.HOME = TMP;
process.env.USERPROFILE = TMP;

type Mod = typeof import('../src/hook_session_start');
let m!: Mod;
type Pk = typeof import('../src/project_key');
let pk!: Pk;
type Se = typeof import('../src/hook_session_end');
let se!: Se;
before(async () => {
  m = await import('../src/hook_session_start');
  pk = await import('../src/project_key');
  se = await import('../src/hook_session_end');
});

const mkGit = (url: string, extra = ''): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exo-pk-'));
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.git', 'config'),
    `[core]\n\tfilemode = true\n[remote "origin"]\n\turl = ${url}\n${extra}`,
  );
  return dir;
};

describe('project_key(R31 三级匹配键)', () => {
  test('ssh/https 两种 URL 归一化到同一 key(搬迁 clone 不断链)', () => {
    const ssh = pk.normalizeGitUrl('git@github.com:alice/repo.git');
    const https = pk.normalizeGitUrl('https://github.com/alice/repo.git');
    assert.equal(ssh, https);
    assert.equal(ssh, 'github.com/alice/repo');
  });

  test('resolveProjectKey: git remote 优先;origin 优先于其它 remote;非 git 落目录兜底', () => {
    const d1 = mkGit('git@github.com:alice/repo.git');
    const d2 = mkGit('https://github.com/alice/repo.git');
    assert.equal(pk.resolveProjectKey(d1), pk.resolveProjectKey(d2), '同仓库不同 checkout 同 key');

    const multi = mkGit('git@gitlab.com:other/mirror.git', '[remote "upstream"]\n\turl = https://github.com/alice/repo.git\n');
    assert.equal(pk.resolveProjectKey(multi), 'gitlab.com/other/mirror', 'origin 优先');

    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'exo-nogit-'));
    assert.equal(pk.resolveProjectKey(plain), path.resolve(plain), '非 git 目录 → 绝对路径兜底');
  });

  test('worktree(.git 是文件)追一层取主仓 remote,取不到落目录兜底', () => {
    const main = mkGit('git@github.com:alice/repo.git');
    const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'exo-wt-'));
    fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${main}/.git/worktrees/wt1`);
    const key = pk.resolveProjectKey(wt);
    assert.equal(key, 'github.com/alice/repo', 'worktree 解析到主仓 remote');
  });
});

describe('hook-session-start(读出侧)', () => {
  test('parseStartPayload: 显式 project_key 优先;缺省按 cwd 现算;坏 JSON 落 process.cwd', () => {
    const p1 = m.parseStartPayload(JSON.stringify({ session_id: 's1', cwd: '/tmp', project_key: 'k1' }));
    assert.equal(p1.project_key, 'k1');
    const p2 = m.parseStartPayload(JSON.stringify({ session_id: 's1', cwd: '/tmp' }));
    assert.equal(p2.project_key, path.resolve('/tmp'));
    const p3 = m.parseStartPayload('not json');
    assert.equal(p3.cwd, process.cwd());
  });

  test('alreadyRequested: 同 session 只请求一次(标记文件)', async () => {
    const { CACHE_DIR } = await import('../src/config');
    const markerDir = path.join(CACHE_DIR, 'handoff-claimed');
    fs.rmSync(markerDir, { recursive: true, force: true });
    assert.equal(m.alreadyRequested('sess-a'), false);
    fs.mkdirSync(markerDir, { recursive: true });
    fs.writeFileSync(path.join(markerDir, 'sess-a.json'), '{}');
    assert.equal(m.alreadyRequested('sess-a'), true);
  });

  test('fetchHandoff: 服务端未上线(404)→ 静默空串;有包 → 返回内容', async () => {
    const client404 = { get: async () => { throw new ApiError(404, 'Not Found'); } };
    assert.equal(await m.fetchHandoff(client404 as any, 's', 'k', '/c'), '');
    const clientOk = { get: async () => ({ handoff: '[ExoMind 接力] 进度: 进行中…' }) };
    assert.match(await m.fetchHandoff(clientOk as any, 's', 'k', '/c'), /接力/);
  });
});

describe('探针 project_key 集成(SessionEnd 写入侧)', () => {
  test('normalizeEvent 以事件 cwd 计算 project_key(非 process.cwd)', () => {
    const dir = mkGit('git@github.com:bob/proj.git');
    const ev = se.normalizeEvent(JSON.stringify({ session_id: 'x', cwd: dir }), 'claude');
    assert.equal(ev.project_key, 'github.com/bob/proj');
    // 显式传入优先(未来上报管道复用)
    const ev2 = se.normalizeEvent(JSON.stringify({ cwd: dir, project_key: 'explicit' }), 'claude');
    assert.equal(ev2.project_key, 'explicit');
  });
});

describe('handoff 命令:项目短名解析', () => {
  test('matchProjectKey: 精确 > 尾段等价 > 子串;无命中 null', async () => {
    const { matchProjectKey } = await import('../src/commands/handoff');
    const known = ['github.com/a/repo', 'gitlab.com/b/other', 'github.com/a/repo-x'];
    assert.equal(matchProjectKey('github.com/a/repo', known), 'github.com/a/repo');
    assert.equal(matchProjectKey('a/repo', known), 'github.com/a/repo');
    assert.equal(matchProjectKey('other', known), 'gitlab.com/b/other');
    assert.equal(matchProjectKey('不存在', known), null);
  });
});

describe('client_key 提交幂等(deriveClientKey)', () => {
  test('同种子稳定/格式合法(8~64 [A-Za-z0-9_-])/不同种子不同', async () => {
    const { deriveClientKey } = await import('../src/manifest');
    const k1 = deriveClientKey('abc');
    assert.equal(k1, deriveClientKey('abc'), '同种子稳定(drain 重投同 key)');
    assert.notEqual(k1, deriveClientKey('abd'));
    assert.match(k1, /^cli-[a-f0-9]{44}$/);
    assert.ok(k1.length >= 8 && k1.length <= 64, `长度 ${k1.length} 合法`);
  });
});

describe('R30-4 漏报补报(reported 标记与补投)', () => {
  test('loadUnreported: 排除已上报/超龄/无 session_id;同 key 去重取最新', async () => {
    const se2 = await import('../src/hook_session_end');
    fs.rmSync(path.join(TMP, '.exomind', 'sessions'), { recursive: true, force: true });
    // 重新指向 HOME 下的 sessions(TMP 即 HOME)
    const dir = path.join(TMP, '.exomind', 'sessions');
    fs.mkdirSync(dir, { recursive: true });
    const mk = (ts: string, sid: string, source = 'claude') =>
      JSON.stringify({ ts, source, session_id: sid, cwd: '/tmp' });
    fs.writeFileSync(
      path.join(dir, 'events.jsonl'),
      [
        mk('2026-10-01T00:00:00Z', 'old'), // 超龄(>7 天,相对测试运行时)
        mk(new Date().toISOString(), 'fresh-1'),
        mk(new Date().toISOString(), 'fresh-1'), // 同 key 重复 → 去重
        mk(new Date().toISOString(), 'fresh-2'),
        JSON.stringify({ ts: new Date().toISOString(), source: 'claude' }), // 无 session_id → 排除
      ].join('\n') + '\n',
    );
    const un = se2.loadUnreported(7);
    assert.equal(un.length, 2, `应只剩 2 条(实际 ${un.length})`);
    assert.ok(un.every((e) => e.session_id!.startsWith('fresh-')));
    // 标记后清零
    se2.markReported(un[0]);
    const un2 = se2.loadUnreported(7);
    assert.equal(un2.length, 1);
  });

  test('replayUnreported: 逐条 POST,成功即标记', async () => {
    const se2 = await import('../src/hook_session_end');
    fs.rmSync(path.join(TMP, '.exomind', 'sessions'), { recursive: true, force: true });
    se2.appendEvent(se2.normalizeEvent(JSON.stringify({ session_id: 'rp-1', cwd: '/tmp' }), 'claude'));
    let posted = 0;
    const fake = {
      post: async () => {
        posted++;
        return {};
      },
    };
    const n = await se2.replayUnreported(fake);
    assert.equal(n, 1);
    assert.equal(posted, 1);
    assert.equal(se2.loadUnreported(7).length, 0, '补投成功后不再出现在候选');
  });
});

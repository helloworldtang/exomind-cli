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

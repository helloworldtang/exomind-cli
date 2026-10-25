/** SessionEnd 采集探针回归(P3 会话编译前置)。HOME 隔离——会真实落 events.jsonl。 */
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'exomind-se-'));
process.env.HOME = TMP;
process.env.USERPROFILE = TMP;

type Mod = typeof import('../src/hook_session_end');
let m!: Mod;
before(async () => {
  m = await import('../src/hook_session_end');
});

describe('hook-session-end(采集探针)', () => {
  test('normalizeEvent: Claude Code payload 取全字段;缺失字段不落键', () => {
    const ev = m.normalizeEvent(
      JSON.stringify({
        session_id: 'abc123',
        transcript_path: '/home/u/.claude/projects/x/abc123.jsonl',
        cwd: '/home/u/proj',
        reason: 'clear',
      }),
      'claude',
      new Date('2026-10-04T12:00:00Z'),
    );
    assert.equal(ev.source, 'claude');
    assert.equal(ev.session_id, 'abc123');
    assert.equal(ev.transcript_path, '/home/u/.claude/projects/x/abc123.jsonl');
    assert.equal(ev.cwd, '/home/u/proj');
    assert.equal(ev.reason, 'clear');
    assert.equal(ev.ts, '2026-10-04T12:00:00.000Z');
    assert.ok(!('bogus' in ev));
  });

  test('normalizeEvent: OpenClaw sessionId 驼峰变体 + 裸文本容错', () => {
    const ev = m.normalizeEvent(JSON.stringify({ sessionId: 's1', workspaceDir: '/w' }), 'openclaw');
    assert.equal(ev.session_id, 's1');
    assert.equal(ev.cwd, '/w');
    // 裸文本(非 JSON)也记事件——至少知道发生过
    const raw = m.normalizeEvent('not json', 'claude');
    assert.equal(raw.source, 'claude');
    assert.ok(!raw.session_id);
  });

  test('appendEvent: 追加 jsonl 且可回读;目录自动创建', () => {
    fs.rmSync(path.join(TMP, '.exomind'), { recursive: true, force: true });
    assert.equal(m.appendEvent({ ts: 't1', source: 'claude' }), true);
    assert.equal(m.appendEvent({ ts: 't2', source: 'openclaw', session_id: 's2' }), true);
    const lines = fs.readFileSync(m.SESSION_EVENTS, 'utf-8').trim().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[1]).session_id, 's2');
  });

  test('isEmptySession: 无用户消息=空;有用户消息/缺文件/无路径=非空(保守)', async () => {
    const empty = path.join(TMP, 'empty.jsonl');
    fs.writeFileSync(empty, ['{"type":"summary","summary":"x"}', '{"type":"meta"}'].join('\n'));
    assert.equal(await m.isEmptySession(empty), true);
    // 路径给了但文件不存在 → 保守视为非空照报
    assert.equal(await m.isEmptySession(path.join(TMP, 'nope.jsonl')), false);
    // 无 transcript_path(OpenClaw 场景)→ 照报
    assert.equal(await m.isEmptySession(undefined), false);
    const worked = path.join(TMP, 'worked.jsonl');
    fs.writeFileSync(
      worked,
      [
        '{"type":"summary","summary":"x"}',
        '{"type":"user","message":{"role":"user","content":"hi"}}',
        '{"type":"assistant","message":{}}',
      ].join('\n'),
    );
    assert.equal(await m.isEmptySession(worked), false);
  });

  test('reportEvent: 成功打标 reported;失败静默返 false 不打标', async () => {
    fs.rmSync(path.join(TMP, '.exomind'), { recursive: true, force: true });
    const ev = { ts: 't', source: 'claude', session_id: 'rep-1' };
    const ev2 = { ts: 't', source: 'claude', session_id: 'rep-2' };
    m.appendEvent(ev);
    m.appendEvent(ev2);
    const okClient = { post: async () => ({}) };
    assert.equal(await m.reportEvent(okClient, ev), true);
    assert.equal(m.loadUnreported().length, 1, '已上报事件不进补投候选');
    const badClient = { post: async () => { throw new Error('net'); } };
    assert.equal(await m.reportEvent(badClient, ev2), false);
    const pending = m.loadUnreported();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].session_id, 'rep-2');
  });
});

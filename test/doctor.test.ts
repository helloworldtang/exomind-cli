import { describe, test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { setJsonMode } from '../src/format';
import { ApiClient } from '../src/api';

let doctor: typeof import('../src/commands/doctor')['default'];
before(async () => {
  doctor = (await import('../src/commands/doctor')).default;
});

const origFetch = global.fetch;
const origHome = process.env.HOME;
const origCodexHome = process.env.CODEX_HOME;

afterEach(() => {
  global.fetch = origFetch;
  process.env.HOME = origHome;
  process.env.CODEX_HOME = origCodexHome;
  setJsonMode(false);
});

/** 捕获 console.log,返回拼接文本。 */
function capture(fn: () => Promise<void>): Promise<string> {
  let out = '';
  const orig = console.log;
  console.log = ((s: unknown) => {
    out += typeof s === 'string' ? s : '';
  }) as typeof console.log;
  return fn().finally(() => {
    console.log = orig;
  }).then(() => out);
}

describe('doctor --json', () => {
  test('输出结构化诊断(hosts 数组 + auth + mcpInitialize),且不泄露凭证', async () => {
    // mock /auth/me → authenticated
    global.fetch = (() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ authenticated: true })),
      })) as typeof fetch;

    // tmp HOME + CODEX_HOME → 各宿主文件都不存在(skill/hook/mcp 均 missing)
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'exo-doc-'));
    process.env.HOME = tmpHome;
    process.env.CODEX_HOME = path.join(tmpHome, '.codex');

    setJsonMode(true);
    const client = new ApiClient({ base_url: 'https://x.test', api_key: 'sk_live_secretvalue123' });
    const out = await capture(() => doctor(client));
    const j = JSON.parse(out);

    assert.ok(Array.isArray(j.hosts), 'hosts 是数组');
    assert.equal(j.hosts.length, 3, 'claude/codex/opencode 三个宿主');
    const codex = j.hosts.find((h: { host: string }) => h.host === 'codex');
    assert.ok(codex, '含 codex 宿主');
    assert.equal(codex.skill, 'missing', 'tmp HOME 下 codex skill 应 missing');
    assert.equal(codex.hook, 'unsupported', 'codex hook = unsupported');
    assert.equal(typeof j.auth.authenticated, 'boolean');
    assert.ok('mcpInitialize' in j);
    assert.ok(!out.includes('sk_live_secretvalue123'), '不泄露 api key 明文');
  });
});

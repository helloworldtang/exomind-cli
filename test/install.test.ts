import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

type Mod = typeof import('../src/commands/install');
let m!: Mod;
before(async () => {
  m = await import('../src/commands/install');
});

const SKILL_CODE = fileURLToPath(new URL('../skill/codex/SKILL.md', import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'exo-install-'));

describe('resolveCodexHome', () => {
  test('CODEX_HOME 未设 → ~/.codex', () => {
    assert.equal(m.resolveCodexHome({}, '/home/u'), '/home/u/.codex');
  });
  test('CODEX_HOME 已设 → 用它(去首尾空白 + resolve 绝对)', () => {
    assert.equal(m.resolveCodexHome({ CODEX_HOME: '  /custom/cx  ' }, '/home/u'), '/custom/cx');
  });
  test('CODEX_HOME 相对路径 → resolve 成绝对', () => {
    assert.ok(path.isAbsolute(m.resolveCodexHome({ CODEX_HOME: 'rel/cx' }, '/home/u')));
  });
});

describe('looksLikeValidToml', () => {
  test('空文件视为合法', () => assert.equal(m.looksLikeValidToml(''), true));
  test('正常 TOML 合法', () => assert.equal(m.looksLikeValidToml('[a]\nx = 1\n'), true));
  test('括号不配平 → 非法', () => assert.equal(m.looksLikeValidToml('[a\nx = 1\n'), false));
  test('含 NUL → 非法', () => assert.equal(m.looksLikeValidToml('a\x00b'), false));
});

describe('configureCodexMcp(codexHome)', () => {
  test('首次写入 / 二次幂等跳过 / 保留用户已有段', () => {
    const home = path.join(tmp(), '.codex');
    const cfg = path.join(home, 'config.toml');

    const r1 = m.configureCodexMcp(home);
    assert.equal(r1.ok, true);
    assert.equal(r1.written, true);
    let c = fs.readFileSync(cfg, 'utf-8');
    assert.ok(c.includes('[mcp_servers.exomind]'));
    assert.ok(c.includes('command = "exomind"'));

    const r2 = m.configureCodexMcp(home);
    assert.equal(r2.ok, true);
    assert.equal(r2.written, false, '二次幂等跳过');

    fs.writeFileSync(cfg, '[mcp_servers.other]\ncommand = "x"\nargs = []\n');
    const r3 = m.configureCodexMcp(home);
    assert.equal(r3.written, true);
    c = fs.readFileSync(cfg, 'utf-8');
    assert.ok(c.includes('[mcp_servers.other]'), '保留用户已有 other 段');
    assert.ok(c.includes('[mcp_servers.exomind]'), '追加 exomind 段');
    assert.ok(c.indexOf('[mcp_servers.other]') < c.indexOf('[mcp_servers.exomind]'));
  });

  test('写入指定 codexHome(不碰默认 ~/.codex)', () => {
    const custom = path.join(tmp(), 'customcx');
    m.configureCodexMcp(custom);
    assert.ok(fs.existsSync(path.join(custom, 'config.toml')));
  });

  test('损坏 TOML 保护:不覆盖原文件', () => {
    const home = path.join(tmp(), '.codex');
    const cfg = path.join(home, 'config.toml');
    fs.mkdirSync(home, { recursive: true });
    const corrupt = '[mcp_servers.other]\ncommand = "x"\n[unclosed'; // 括号不配平
    fs.writeFileSync(cfg, corrupt);
    const r = m.configureCodexMcp(home);
    assert.equal(r.ok, false);
    assert.equal(r.written, false);
    assert.equal(fs.readFileSync(cfg, 'utf-8'), corrupt, '原文件保持不变');
  });
});

describe('installCodexSkill', () => {
  test('拷贝 SKILL.md → <codexHome>/skills/exomind/SKILL.md', () => {
    const home = path.join(tmp(), '.codex');
    const r = m.installCodexSkill(home, SKILL_CODE);
    assert.equal(r.ok, true);
    assert.ok(fs.existsSync(r.dest));
    assert.ok(fs.readFileSync(r.dest, 'utf-8').includes('name: exomind'));
  });
  test('幂等:再装一次覆盖(内容最新,不报错)', () => {
    const home = path.join(tmp(), '.codex');
    m.installCodexSkill(home, SKILL_CODE);
    const r2 = m.installCodexSkill(home, SKILL_CODE);
    assert.equal(r2.ok, true);
  });
  test('源缺失 → ok=false + reason', () => {
    const r = m.installCodexSkill(path.join(tmp(), '.codex'), '/nonexistent/SKILL.md');
    assert.equal(r.ok, false);
    assert.ok(r.reason);
  });
});

describe('Codex SKILL.md frontmatter', () => {
  test('name=exomind + description 含中文触发词(jdit/存档)', () => {
    const fm = fs.readFileSync(SKILL_CODE, 'utf-8').split('---')[1] || '';
    assert.match(fm, /name:\s*exomind/);
    assert.ok(fm.includes('jdit'), 'description 含 jdit');
    assert.ok(fm.includes('存档'), 'description 含 存档');
  });
});

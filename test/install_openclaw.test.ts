/** OpenClaw 集成回归: skill 安装 / 插件三件套生成 / 路径解析。
 *  不真跑 openclaw CLI(本机装有 OpenClaw,spawn 会产生真实副作用)。 */
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'exomind-oc-'));
process.env.HOME = TMP;
process.env.USERPROFILE = TMP;

type Mod = typeof import('../src/commands/install_openclaw');
let m!: Mod;
const SKILL_SRC = fileURLToPath(new URL('../skill/claude/SKILL.md', import.meta.url));
before(async () => {
  m = await import('../src/commands/install_openclaw');
});

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'exo-oc-'));

describe('resolveOpenclawHome', () => {
  test('OPENCLAW_HOME 未设 → ~/.openclaw', () => {
    assert.equal(m.resolveOpenclawHome({}, '/home/u'), '/home/u/.openclaw');
  });
  test('OPENCLAW_HOME 已设 → 用它(去空白 + resolve 绝对)', () => {
    assert.equal(m.resolveOpenclawHome({ OPENCLAW_HOME: '  /custom/oc  ' }, '/home/u'), '/custom/oc');
  });
});

describe('installOpenclawSkill', () => {
  test('拷贝 SKILL.md → <openclawHome>/skills/exomind/SKILL.md,幂等覆盖,无 tmp 残留', () => {
    const home = tmp();
    const r1 = m.installOpenclawSkill(home, SKILL_SRC);
    assert.equal(r1.ok, true);
    assert.ok(fs.existsSync(path.join(home, 'skills', 'exomind', 'SKILL.md')));
    assert.equal(fs.readFileSync(r1.dest, 'utf-8'), fs.readFileSync(SKILL_SRC, 'utf-8'));
    const r2 = m.installOpenclawSkill(home, SKILL_SRC); // 幂等
    assert.equal(r2.ok, true);
    const leftovers = fs.readdirSync(path.join(home, 'skills', 'exomind')).filter((f) => f.includes('.tmp'));
    assert.deepEqual(leftovers, []);
  });
  test('源缺失 → ok=false + reason', () => {
    const r = m.installOpenclawSkill(tmp(), path.join(tmp(), 'nope.md'));
    assert.equal(r.ok, false);
    assert.ok(r.reason);
  });
});

describe('openclawPluginFiles', () => {
  test('三件套齐全,JSON 可解析,manifest 声明 hook 能力', () => {
    const files = m.openclawPluginFiles('/opt/homebrew/bin/emcli', '0.21.0');
    assert.deepEqual(Object.keys(files).sort(), ['index.ts', 'openclaw.plugin.json', 'package.json']);
    const manifest = JSON.parse(files['openclaw.plugin.json']);
    assert.equal(manifest.id, 'exomind');
    assert.deepEqual(manifest.activation.onCapabilities, ['hook']);
    const pkg = JSON.parse(files['package.json']);
    assert.equal(pkg.version, '0.21.0');
    assert.deepEqual(pkg.openclaw.extensions, ['./index.ts']);
  });
  test('index.ts: emcli 绝对路径烧入 + before_prompt_build 桥接 + prependContext 注入', () => {
    const ts = m.openclawPluginFiles('/opt/homebrew/bin/emcli', '0.21.0')['index.ts'];
    assert.ok(ts.includes('const EMCLI = "/opt/homebrew/bin/emcli"'), '烧入绝对路径(gateway PATH 不可靠)');
    assert.ok(ts.includes("api.on('before_prompt_build'"));
    assert.ok(ts.includes('prependContext'));
    assert.ok(ts.includes("spawn(EMCLI, ['hook']"), '桥接现有 emcli hook,不重写逻辑');
    assert.ok(ts.includes('DEADLINE_MS'), '超时保护');
  });
  test('index.ts: 含空格/引号的路径正确转义为字符串字面量', () => {
    const ts = m.openclawPluginFiles('/usr/local/bin/my emcli', '0.21.0')['index.ts'];
    assert.ok(ts.includes('const EMCLI = "/usr/local/bin/my emcli"'));
  });
});

describe('writeOpenclawPlugin', () => {
  test('写盘三文件,无 tmp 残留', () => {
    const dir = path.join(tmp(), 'openclaw-plugin');
    const r = m.writeOpenclawPlugin(dir, '/bin/emcli', '1.2.3');
    assert.equal(r.dir, dir);
    assert.equal(r.files.length, 3);
    for (const f of r.files) assert.ok(fs.existsSync(f));
    assert.deepEqual(
      fs.readdirSync(dir).filter((f) => f.includes('.tmp')),
      [],
    );
  });
});

describe('configureOpenclawHookAccess', () => {
  test('首次写入 allowConversationAccess=true;保留其它配置;幂等', () => {
    const home = tmp();
    const file = path.join(home, 'openclaw.json');
    fs.writeFileSync(file, JSON.stringify({ models: { x: 1 }, plugins: { entries: { deepseek: { enabled: true } } } }));
    let backedUp = 0;
    const r1 = m.configureOpenclawHookAccess(home, () => {
      backedUp++;
    });
    assert.equal(r1.ok, true);
    const d = JSON.parse(fs.readFileSync(file, 'utf-8'));
    assert.equal(d.plugins.entries.exomind.hooks.allowConversationAccess, true);
    assert.equal(d.models.x, 1, '不碰无关配置');
    assert.equal(d.plugins.entries.deepseek.enabled, true, '不碰其它插件 entry');
    const r2 = m.configureOpenclawHookAccess(home); // 幂等
    assert.equal(r2.ok, true);
  });

  test('文件不存在 → 创建只含必要结构;坏 JSON → 不覆盖', () => {
    const fresh = tmp();
    const r = m.configureOpenclawHookAccess(fresh);
    assert.equal(r.ok, true);
    const d = JSON.parse(fs.readFileSync(path.join(fresh, 'openclaw.json'), 'utf-8'));
    assert.equal(d.plugins.entries.exomind.hooks.allowConversationAccess, true);

    const bad = tmp();
    fs.writeFileSync(path.join(bad, 'openclaw.json'), '{not json');
    const rb = m.configureOpenclawHookAccess(bad);
    assert.equal(rb.ok, false);
    assert.match(fs.readFileSync(path.join(bad, 'openclaw.json'), 'utf-8'), /^\{not json$/, '坏文件保持原样');
  });
});

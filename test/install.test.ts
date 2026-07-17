import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

type Mod = typeof import('../src/commands/install');
let m!: Mod;
before(async () => {
  m = await import('../src/commands/install');
});

describe('configureCodexMcp', () => {
  test('幂等：首次写入 / 二次跳过 / 保留用户已有段', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'exo-codex-'));
    const prev = process.env.HOME;
    process.env.HOME = tmp;
    try {
      const cfg = path.join(tmp, '.codex', 'config.toml');

      // 首次：文件不存在 → 创建并注入 [mcp_servers.exomind]
      assert.equal(m.configureCodexMcp(), true);
      assert.ok(fs.existsSync(cfg));
      let c = fs.readFileSync(cfg, 'utf-8');
      assert.ok(c.includes('[mcp_servers.exomind]'));
      assert.ok(c.includes('command = "exomind"'));
      assert.ok(c.includes('args = ["mcp"]'));

      // 二次：已存在该段 → 幂等跳过（不重复追加）
      assert.equal(m.configureCodexMcp(), false);

      // 保留用户已有段：预设 [mcp_servers.other]，注入 exomind 且不破坏 other
      fs.writeFileSync(cfg, '[mcp_servers.other]\ncommand = "x"\nargs = []\n');
      assert.equal(m.configureCodexMcp(), true);
      c = fs.readFileSync(cfg, 'utf-8');
      assert.ok(c.includes('[mcp_servers.other]'), '保留用户已有 other 段');
      assert.ok(c.includes('[mcp_servers.exomind]'), '追加 exomind 段');
      // exomind 段应追加在 other 之后（不重写整个文件）
      assert.ok(c.indexOf('[mcp_servers.other]') < c.indexOf('[mcp_servers.exomind]'));
    } finally {
      process.env.HOME = prev;
    }
  });
});

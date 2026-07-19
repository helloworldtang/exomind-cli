/** exomind install — 拷贝 skill 到 ~/.claude/skills/exomind/,可选写 UserPromptSubmit hook。 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import type { ApiClient } from '../api';
import { ok, dim, yellow } from '../format';
import { DEFAULT_BASE_URL, loadConfig } from '../config';

// CJS 输出: __dirname = dist/,上一级即包根 → skill/SKILL.md
const PKG_ROOT = path.resolve(__dirname, '..');
const SKILL_SRC = path.join(PKG_ROOT, 'skill', 'SKILL.md');

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function backup(file: string): void {
  if (!fs.existsSync(file)) return;
  const bak = `${file}.bak-${Date.now()}`;
  try {
    fs.copyFileSync(file, bak);
    console.log(dim(`  (已备份 → ${path.basename(bak)})`));
  } catch {
    return;
  }
  pruneBackups(file, 3);
}

/** 清理同一文件的旧 .bak-*,保留最近 keep 个(避免反复 install 堆积)。 */
function pruneBackups(file: string, keep: number): void {
  try {
    const dir = path.dirname(file);
    const prefix = path.basename(file) + '.bak-';
    const olds = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(prefix))
      .map((f) => ({ f, mt: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mt - a.mt);
    for (const o of olds.slice(keep)) {
      try {
        fs.unlinkSync(path.join(dir, o.f));
      } catch {
        /* 忽略单个删除失败 */
      }
    }
  } catch {
    /* 忽略 */
  }
}

/** 从指定 JSON 文件移除 mcpServers.exomind（清理会覆盖 stdio 的残留 SSE/旧条目）。幂等，返回是否改动。 */
function purgeMcpExomind(file: string): boolean {
  const d = readJson(file);
  if (!d) return false;
  const grp = d.mcpServers as Record<string, unknown> | undefined;
  if (!grp || !grp.exomind) return false;
  delete grp.exomind;
  if (Object.keys(grp).length === 0) delete d.mcpServers;
  backup(file);
  fs.writeFileSync(file, JSON.stringify(d, null, 2) + '\n');
  return true;
}

/** 幂等注入 [mcp_servers.exomind] 到 ~/.codex/config.toml（Codex 用 TOML）。
 *  追加式（非完整 TOML 重写），保留用户已有内容/注释；已存在该段则跳过。返回是否写入。 */
export function configureCodexMcp(): boolean {
  const codexConfig = path.join(os.homedir(), '.codex', 'config.toml');
  try {
    fs.mkdirSync(path.dirname(codexConfig), { recursive: true });
  } catch {
    /* 权限等 */
  }
  let existing = '';
  try {
    existing = fs.readFileSync(codexConfig, 'utf-8');
  } catch {
    existing = '';
  }
  // 幂等：已有 [mcp_servers.exomind] 段则跳过（不覆盖用户自定义）
  if (/^\[mcp_servers\.exomind\]\s*$/m.test(existing)) {
    return false;
  }
  backup(codexConfig);
  const prefix = existing && !existing.endsWith('\n') ? '\n\n' : existing ? '\n' : '';
  const snippet = `${prefix}[mcp_servers.exomind]
command = "exomind"
args = ["mcp"]
`;
  fs.writeFileSync(codexConfig, existing + snippet);
  return true;
}

/** 自检：spawn `exomind mcp` 发 initialize，验证 MCP 服务端能启动并响应（抓"升级把 MCP 搞坏"）。 */
function checkMcp(timeoutMs = 6000): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      // shell: 仅 Windows 需(找 .cmd/.exe);Linux/macOS 直接 exec,避免 Node22 DEP0190 警告
      child = spawn('exomind', ['mcp'], { stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    } catch (e) {
      resolve({ ok: false, detail: `无法启动: ${e instanceof Error ? e.message : e}` });
      return;
    }
    let out = '';
    let done = false;
    const finish = (r: { ok: boolean; detail: string }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        /* 忽略 */
      }
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, detail: '超时未响应 initialize' }), timeoutMs);
    child.stdout?.on('data', (d: Buffer) => {
      out += d.toString();
      if (out.includes('"serverInfo"')) finish({ ok: true, detail: 'initialize 响应正常' });
    });
    child.on('error', (e: Error) => finish({ ok: false, detail: `启动失败: ${e.message}` }));
    child.on('close', () => {
      if (!out.includes('"serverInfo"')) finish({ ok: false, detail: '未响应 initialize 即退出' });
    });
    try {
      child.stdin?.write(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'install-check', version: '1' } },
          id: 1,
        }) + '\n',
      );
    } catch {
      finish({ ok: false, detail: '写入 stdin 失败' });
    }
  });
}

export default async function install(
  client: ApiClient,
  opts: { hook?: boolean; mcp?: boolean },
): Promise<void> {
  const claudeDir = path.join(os.homedir(), '.claude');
  const skillDestDir = path.join(claudeDir, 'skills', 'exomind');

  // 1. 拷贝 skill
  if (!fs.existsSync(SKILL_SRC)) {
    throw new Error(`skill 源不存在: ${SKILL_SRC}(npm 包可能损坏,或开发模式下未构建)`);
  }
  fs.mkdirSync(skillDestDir, { recursive: true });
  fs.copyFileSync(SKILL_SRC, path.join(skillDestDir, 'SKILL.md'));
  console.log(ok('已安装 Claude Code skill'));
  console.log(dim(`  → ${skillDestDir}/SKILL.md`));

  // 2. 默认: 写 UserPromptSubmit hook(--no-hook 关闭;commander 默认 true)
  if (opts.hook !== false) {
    const settingsFile = path.join(claudeDir, 'settings.json');
    fs.mkdirSync(claudeDir, { recursive: true });
    backup(settingsFile);

    const settings = (readJson(settingsFile) ?? {}) as Record<string, unknown>;
    const hooks = (settings.hooks as Record<string, unknown>) ?? {};
    const list = (Array.isArray(hooks.UserPromptSubmit) ? hooks.UserPromptSubmit : []) as Array<{
      hooks?: Array<{ type?: string; command?: string }>;
    }>;

    // 幂等: 移除已存在的 exomind hook,保留其它工具的 hook
    const kept = list.filter(
      (m) => !(m.hooks || []).some((h) => String(h.command || '').includes('exomind')),
    );
    kept.push({
      hooks: [{ type: 'command', command: 'exomind hook', statusMessage: 'ExoMind 知识库检索' }],
    });
    hooks.UserPromptSubmit = kept;
    settings.hooks = hooks;

    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
    console.log(ok('已配置 UserPromptSubmit hook → exomind hook'));
    console.log(dim('  重启 Claude Code 生效。hook 出错不会阻塞你的输入(错误只进 stderr)。'));
  }

  // 3. 默认: 写 MCP server(Claude Code + OpenCode;--no-mcp 关闭;补能力层,免手改 JSON)
  if (opts.mcp !== false) {
    // Claude Code: ~/.claude.json → mcpServers.exomind
    const ccJson = path.join(os.homedir(), '.claude.json');
    backup(ccJson);
    const cc = (readJson(ccJson) ?? {}) as Record<string, unknown>;
    const ccMcp = (cc.mcpServers as Record<string, unknown>) ?? {};
    ccMcp.exomind = { command: 'exomind', args: ['mcp'] };
    cc.mcpServers = ccMcp;
    fs.writeFileSync(ccJson, JSON.stringify(cc, null, 2) + '\n');

    // OpenCode: ~/.config/opencode/opencode.json → mcp.exomind
    const ocJson = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
    fs.mkdirSync(path.dirname(ocJson), { recursive: true });
    backup(ocJson);
    const oc = (readJson(ocJson) ?? {}) as Record<string, unknown>;
    const ocMcp = (oc.mcp as Record<string, unknown>) ?? {};
    ocMcp.exomind = { type: 'local', command: ['exomind', 'mcp'] };
    oc.mcp = ocMcp;
    fs.writeFileSync(ocJson, JSON.stringify(oc, null, 2) + '\n');

    // Codex: ~/.codex/config.toml → [mcp_servers.exomind]（TOML，幂等追加）
    configureCodexMcp();

    // 清理会覆盖 stdio 的残留 exomind MCP 条目（settings.json mcpServers + 项目级 .mcp.json）
    // 否则项目级/用户级 SSE 等旧条目优先级更高，会盖住 stdio → MCP 401
    const purged: string[] = [];
    if (purgeMcpExomind(path.join(claudeDir, 'settings.json'))) purged.push('~/.claude/settings.json');
    let curDir = process.cwd();
    for (let i = 0; i < 12 && curDir !== path.dirname(curDir); i++) {
      const f = path.join(curDir, '.mcp.json');
      if (fs.existsSync(f) && purgeMcpExomind(f)) purged.push(f.replace(os.homedir(), '~'));
      curDir = path.dirname(curDir);
    }
    if (purged.length) console.log(dim(`  → 清理残留 exomind MCP 条目（避免覆盖 stdio）: ${purged.join(', ')}`));

    console.log(ok('已配置 MCP server → exomind mcp'));
    console.log(dim('  → Claude Code: ~/.claude.json (mcpServers.exomind)'));
    console.log(dim('  → OpenCode: ~/.config/opencode/opencode.json (mcp.exomind)'));
    console.log(dim('  → Codex: ~/.codex/config.toml ([mcp_servers.exomind])'));
    console.log(dim('  重启对应 Agent → 拿到 mcp__exomind__* 工具'));
  }

  // 4. 迁移过时 base_url（d.youhuale.cn → 默认域），让 stdio MCP 子进程用最新域名
  const cfgFile = path.join(os.homedir(), '.exomind', 'config.json');
  const cfg = readJson(cfgFile);
  if (cfg && typeof cfg.base_url === 'string' && cfg.base_url.includes('d.youhuale.cn')) {
    backup(cfgFile);
    cfg.base_url = DEFAULT_BASE_URL;
    fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + '\n');
    console.log(ok(`已迁移 base_url: d.youhuale.cn → ${DEFAULT_BASE_URL}`));
    console.log(dim('  (stdio MCP 子进程读此配置，重启 Agent 后用新域名)'));
  }

  // 5. 可用性自检（避免"升级提示成功、实际把功能搞坏了用户却不知道"）
  const live = loadConfig();
  const keyHint = live.api_key ? `${live.api_key.slice(0, 8)}…${live.api_key.slice(-4)}` : '';
  let me: { authenticated?: boolean; tenant_id?: string; login?: string } | null = null;
  if (live.api_key) {
    // /auth/me 重试 3 次 + 短超时(6s):扛用户网络抖动(如 VPN 瞬时丢包)。
    // 服务端 validate_api_key 也已加 ECS→auth 远程重试(第②段),两段都有重试。
    for (let i = 0; i < 3; i++) {
      try {
        me = (await client.get('/auth/me', { timeoutMs: 6000 })) as {
          authenticated?: boolean;
          tenant_id?: string;
          login?: string;
        };
        if (me && me.authenticated) break;
      } catch {
        me = null; // 网络错 / key 无效
      }
      if (i < 2) await new Promise((r) => setTimeout(r, 1000));
    }
  }
  const mcp = live.api_key ? await checkMcp() : { ok: false, detail: '未配置 API Key' };

  console.log(yellow('\n可用性自检:'));
  if (!live.api_key) {
    console.log(dim('  （未配置 API Key，跳过自检；exomind login 后重跑 install 可自检）'));
  } else {
    // 凭证细节(tenant/keyHint)并入自检行,只在「自检」出现一次
    console.log(
      me && me.authenticated
        ? ok(`  服务器连通 + 鉴权有效（tenant ${me.tenant_id} · ${keyHint}）`)
        : yellow('  ✗ 服务器连通/鉴权异常 → exomind me 核验'),
    );
    console.log(mcp.ok ? ok(`  MCP 服务端可用（${mcp.detail}）`) : yellow(`  ✗ MCP 服务端异常：${mcp.detail}`));
  }

  console.log(yellow('\n下一步:'));
  if (!live.api_key) {
    console.log(dim('  1. exomind login（粘贴 API Key）'));
    console.log(dim('  2. 重启 Claude Code（加载 skill/hook/MCP）→ mcp__exomind__* 生效'));
  } else if (me && me.authenticated && mcp.ok) {
    console.log(dim('  自检全过 → 重启 Claude Code（skill/hook/MCP 启动时载入）即生效'));
  } else {
    console.log(yellow('自检有异常，请按上方 ✗ 提示核验后再重启使用。'));
  }
}

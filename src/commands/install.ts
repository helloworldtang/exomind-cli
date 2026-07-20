/** exomind install — 装 skill(Claude+Codex)+ hook(Claude 独有)+ MCP(Claude/OpenCode/Codex)。
 *  Codex = skill + MCP(无 Claude 的 UserPromptSubmit hook);--host 选择性装某个宿主。 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import type { ApiClient } from '../api';
import { ok, dim, yellow } from '../format';
import { DEFAULT_BASE_URL, loadConfig } from '../config';

// CJS 输出: __dirname = dist/,上一级即包根 → skill/claude|codex/SKILL.md
const PKG_ROOT = path.resolve(__dirname, '..');
export const CLAUDE_SKILL_SRC = path.join(PKG_ROOT, 'skill', 'claude', 'SKILL.md');
export const CODEX_SKILL_SRC = path.join(PKG_ROOT, 'skill', 'codex', 'SKILL.md');

export type Host = 'claude' | 'codex' | 'opencode';

export interface InstallOpts {
  host?: Host; // 缺省 undefined = 全装;指定则只装该宿主
  hook?: boolean; // --no-hook:仅跳过本次 hook(不删已有)
  mcp?: boolean; // --no-mcp:仅跳过本次 MCP 配置
  skill?: boolean; // --no-skill:仅跳过本次 skill 刷新(不删已有)
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function backup(file: string): void {
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

/** 解析 Codex home:优先 CODEX_HOME env(去空白),否则 ~/.codex。
 *  skill 安装与 MCP 配置共用同一解析,避免一个用 env、一个硬编码 ~ 的隐患。 */
export function resolveCodexHome(env = process.env, homeDir = os.homedir()): string {
  const configured = (env.CODEX_HOME ?? '').trim();
  return configured ? path.resolve(configured) : path.join(homeDir, '.codex');
}

/** 轻量 TOML 合法性启发式校验(零依赖):括号配平 + 无 NUL/二进制垃圾。
 *  非完整 parser,抓不住所有语法错,但明显损坏(括号不配平/二进制)能拦下,避免覆盖坏文件。 */
export function looksLikeValidToml(text: string): boolean {
  if (!text.trim()) return true; // 空文件视为合法
  if (/\x00/.test(text)) return false; // NUL → 二进制垃圾
  let brackets = 0;
  for (const ch of text) {
    if (ch === '[') brackets++;
    else if (ch === ']') brackets--;
    if (brackets < 0) return false; // ] 多于 [ → 损坏
  }
  return brackets === 0;
}

/** 幂等注入 [mcp_servers.exomind] 到 <codexHome>/config.toml。
 *  写前校验现有 TOML(损坏则停止不覆盖)、备份、幂等追加(已有段则跳过)、写后复验。
 *  返回 {ok, written, reason}。零依赖文本法(启发式校验,备份兜底回滚)。 */
export function configureCodexMcp(
  codexHome: string,
): { ok: boolean; written: boolean; reason?: string; file: string } {
  const codexConfig = path.join(codexHome, 'config.toml');
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
  // 写前校验:现有文件明显损坏 → 停止,保留原文件
  if (existing && !looksLikeValidToml(existing)) {
    return {
      ok: false,
      written: false,
      file: codexConfig,
      reason: `config.toml 疑似损坏(括号不配平/含二进制),已保留原文件未改: ${codexConfig}`,
    };
  }
  // 幂等:已有 [mcp_servers.exomind] 段则跳过(不覆盖用户自定义)
  if (/^\[mcp_servers\.exomind\]\s*$/m.test(existing)) {
    return { ok: true, written: false, file: codexConfig };
  }
  backup(codexConfig);
  const prefix = existing && !existing.endsWith('\n') ? '\n\n' : existing ? '\n' : '';
  const snippet = `${prefix}[mcp_servers.exomind]
command = "exomind"
args = ["mcp"]
`;
  fs.writeFileSync(codexConfig, existing + snippet);
  // 写后复验
  const after = fs.readFileSync(codexConfig, 'utf-8');
  if (!/^\[mcp_servers\.exomind\]\s*$/m.test(after) || !looksLikeValidToml(after)) {
    return { ok: false, written: true, file: codexConfig, reason: '写后复验失败(段未写入或文件损坏)' };
  }
  return { ok: true, written: true, file: codexConfig };
}

/** 装 Codex skill:拷 skill/codex/SKILL.md → <codexHome>/skills/exomind/SKILL.md。
 *  原子写(tmp+rename)+ 备份 + 幂等(覆盖)。 */
export function installCodexSkill(
  codexHome: string,
  skillSrc = CODEX_SKILL_SRC,
): { ok: boolean; dest: string; reason?: string } {
  const destDir = path.join(codexHome, 'skills', 'exomind');
  const dest = path.join(destDir, 'SKILL.md');
  if (!fs.existsSync(skillSrc)) {
    return { ok: false, dest, reason: `skill 源不存在: ${skillSrc}` };
  }
  fs.mkdirSync(destDir, { recursive: true });
  backup(dest);
  const tmp = `${dest}.tmp-${Date.now()}`;
  fs.writeFileSync(tmp, fs.readFileSync(skillSrc));
  fs.renameSync(tmp, dest);
  return { ok: true, dest };
}

/** 从指定 JSON 文件移除 mcpServers.exomind(清理会覆盖 stdio 的残留 SSE/旧条目)。幂等,返回是否改动。 */
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

/** 自检:spawn `exomind mcp` 发 initialize,验证 MCP 服务端能启动并响应(抓"升级把 MCP 搞坏")。 */
export function checkMcp(timeoutMs = 6000): Promise<{ ok: boolean; detail: string }> {
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

export default async function install(client: ApiClient, opts: InstallOpts): Promise<void> {
  if (opts.host && !['claude', 'codex', 'opencode'].includes(opts.host)) {
    throw new Error(`未知 --host: ${opts.host}(可选: claude | codex | opencode)`);
  }
  const claudeDir = path.join(os.homedir(), '.claude');
  const skillDestDir = path.join(claudeDir, 'skills', 'exomind');
  const codexHome = resolveCodexHome();
  // want(h): 缺省(未指定 --host)全装;指定了就只装该 host
  const want = (h: Host) => !opts.host || opts.host === h;

  // 1. skill(Claude + Codex)
  if (opts.skill !== false) {
    if (want('claude')) {
      if (!fs.existsSync(CLAUDE_SKILL_SRC)) {
        throw new Error(`Claude skill 源不存在: ${CLAUDE_SKILL_SRC}(npm 包可能损坏,或开发模式下未构建)`);
      }
      fs.mkdirSync(skillDestDir, { recursive: true });
      fs.copyFileSync(CLAUDE_SKILL_SRC, path.join(skillDestDir, 'SKILL.md'));
      console.log(ok('已安装 Claude Code skill'));
      console.log(dim(`  → ${skillDestDir}/SKILL.md`));
    }
    if (want('codex')) {
      const r = installCodexSkill(codexHome);
      if (r.ok) {
        console.log(ok('已安装 Codex skill'));
        console.log(dim(`  → ${r.dest}`));
      } else {
        console.log(yellow(`✗ Codex skill 安装失败: ${r.reason}`));
      }
    }
  }

  // 2. UserPromptSubmit hook(仅 Claude;Codex 当前无等价 prompt-submit hook)
  if (opts.hook !== false && want('claude')) {
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
    console.log(ok('已配置 UserPromptSubmit hook → exomind hook (Claude Code 独有)'));
    console.log(dim('  Codex 当前无对应 prompt-submit hook,靠 skill 触发(jdit/存档/查询)。'));
  }

  // 3. MCP server(Claude/OpenCode/Codex)
  if (opts.mcp !== false) {
    const configured: string[] = [];
    if (want('claude')) {
      const ccJson = path.join(os.homedir(), '.claude.json');
      backup(ccJson);
      const cc = (readJson(ccJson) ?? {}) as Record<string, unknown>;
      const ccMcp = (cc.mcpServers as Record<string, unknown>) ?? {};
      ccMcp.exomind = { command: 'exomind', args: ['mcp'] };
      cc.mcpServers = ccMcp;
      fs.writeFileSync(ccJson, JSON.stringify(cc, null, 2) + '\n');
      configured.push('Claude Code (~/.claude.json)');
    }
    if (want('opencode')) {
      const ocJson = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
      fs.mkdirSync(path.dirname(ocJson), { recursive: true });
      backup(ocJson);
      const oc = (readJson(ocJson) ?? {}) as Record<string, unknown>;
      const ocMcp = (oc.mcp as Record<string, unknown>) ?? {};
      ocMcp.exomind = { type: 'local', command: ['exomind', 'mcp'] };
      oc.mcp = ocMcp;
      fs.writeFileSync(ocJson, JSON.stringify(oc, null, 2) + '\n');
      configured.push('OpenCode (~/.config/opencode/opencode.json)');
    }
    if (want('codex')) {
      const r = configureCodexMcp(codexHome);
      if (r.ok) configured.push(`Codex (${r.file})`);
      else console.log(yellow(`✗ Codex MCP 配置失败: ${r.reason}`));
    }

    // 清理会覆盖 stdio 的残留 exomind MCP 条目(settings.json mcpServers + 项目级 .mcp.json)
    // 否则项目级/用户级 SSE 等旧条目优先级更高,会盖住 stdio → MCP 401
    const purged: string[] = [];
    if (want('claude') && purgeMcpExomind(path.join(claudeDir, 'settings.json'))) {
      purged.push('~/.claude/settings.json');
    }
    let curDir = process.cwd();
    for (let i = 0; i < 12 && curDir !== path.dirname(curDir); i++) {
      const f = path.join(curDir, '.mcp.json');
      if (fs.existsSync(f) && purgeMcpExomind(f)) purged.push(f.replace(os.homedir(), '~'));
      curDir = path.dirname(curDir);
    }
    if (purged.length) console.log(dim(`  → 清理残留 exomind MCP 条目(避免覆盖 stdio): ${purged.join(', ')}`));

    if (configured.length) {
      console.log(ok('已配置 MCP server → exomind mcp'));
      for (const c of configured) console.log(dim(`  → ${c}`));
      console.log(dim('  重启对应 Agent → 拿到 mcp__exomind__* 工具'));
    }
  }

  // 4. 迁移过时 base_url(d.youhuale.cn → 默认域),让 stdio MCP 子进程用最新域名
  const cfgFile = path.join(os.homedir(), '.exomind', 'config.json');
  const cfg = readJson(cfgFile);
  if (cfg && typeof cfg.base_url === 'string' && cfg.base_url.includes('d.youhuale.cn')) {
    backup(cfgFile);
    cfg.base_url = DEFAULT_BASE_URL;
    fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + '\n');
    console.log(ok(`已迁移 base_url: d.youhuale.cn → ${DEFAULT_BASE_URL}`));
    console.log(dim('  (stdio MCP 子进程读此配置,重启 Agent 后用新域名)'));
  }

  // 5. 可用性自检(避免"升级提示成功、实际把功能搞坏了用户却不知道")
  const live = loadConfig();
  const keyHint = live.api_key ? `${live.api_key.slice(0, 8)}…${live.api_key.slice(-4)}` : '';
  let me: { authenticated?: boolean; tenant_id?: string; login?: string } | null = null;
  if (live.api_key) {
    for (let i = 0; i < 3; i++) {
      try {
        me = (await client.get('/auth/me', { timeoutMs: 6000 })) as {
          authenticated?: boolean;
          tenant_id?: string;
          login?: string;
        };
        if (me && me.authenticated) break;
      } catch {
        me = null;
      }
      if (i < 2) await new Promise((r) => setTimeout(r, 1000));
    }
  }
  const mcp = live.api_key ? await checkMcp() : { ok: false, detail: '未配置 API Key' };

  // 本地宿主安装检查(Codex skill 文件 + 各 MCP 配置存在性)
  const codexSkillOk = fs.existsSync(path.join(codexHome, 'skills', 'exomind', 'SKILL.md'));
  const codexMcfgOk = (() => {
    try {
      return /^\[mcp_servers\.exomind\]\s*$/m.test(fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf-8'));
    } catch {
      return false;
    }
  })();

  console.log(yellow('\n可用性自检:'));
  if (!live.api_key) {
    console.log(dim('  (未配置 API Key,跳过服务端自检;exomind login 后重跑 install 可自检)'));
  } else {
    console.log(
      me && me.authenticated
        ? ok(`  服务器连通 + 鉴权有效(tenant ${me.tenant_id} · ${keyHint})`)
        : yellow('  ✗ 服务器连通/鉴权异常 → exomind me 核验'),
    );
    console.log(mcp.ok ? ok(`  MCP 服务端可用(${mcp.detail})`) : yellow(`  ✗ MCP 服务端异常: ${mcp.detail}`));
  }
  if (want('codex')) {
    console.log(codexSkillOk ? ok('  Codex skill 已安装') : yellow('  ✗ Codex skill 未安装'));
    console.log(codexMcfgOk ? ok('  Codex MCP 配置存在') : yellow('  ✗ Codex MCP 配置缺失'));
    console.log(dim('  △ Codex 无 UserPromptSubmit hook,依赖 skill 触发(jdit/存档/查询)'));
  }

  console.log(yellow('\n下一步:'));
  if (!live.api_key) {
    console.log(dim('  1. exomind login(粘贴 API Key)'));
    console.log(dim('  2. 重启 Agent(Claude Code / Codex)加载 skill/MCP → mcp__exomind__* 生效'));
  } else if (me && me.authenticated && mcp.ok) {
    console.log(dim('  自检全过 → 重启 Agent(skill/MCP 启动时载入)即生效'));
  } else {
    console.log(yellow('  自检有异常,按上方 ✗ 提示核验后再重启使用。'));
  }
}

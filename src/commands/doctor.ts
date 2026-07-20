/** exomind doctor — 诊断各宿主(claude/codex/opencode)的 skill/hook/MCP 安装状态 + 鉴权 + MCP initialize。
 *  依赖 install.ts 的 resolveCodexHome + checkMcp(复用,不另造)。--json 走全局 --json 开关,输出脱敏。 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { ApiClient } from '../api';
import { resolveCodexHome, checkMcp } from './install';
import { isJsonMode, ok, dim, yellow, red } from '../format';

type Status = 'ok' | 'missing' | 'invalid' | 'unsupported' | 'failed' | 'skipped';

interface HostCheck {
  host: string;
  skill: Status;
  hook: Status;
  mcpConfig: Status;
  paths: string[];
  detail?: string;
}

function readText(p: string): string {
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch {
    return '';
  }
}
function fileExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}
function mcpServersExomind(jsonFile: string, key: 'mcpServers' | 'mcp'): boolean {
  try {
    const d = JSON.parse(readText(jsonFile)) as Record<string, any>;
    const grp = key === 'mcpServers' ? d.mcpServers : d.mcp;
    return !!(grp && grp.exomind);
  } catch {
    return false;
  }
}

/** 状态徽章(人类可读):ok 绿✓ / missing 黄✗ / unsupported 灰— / 其它 红✗。 */
function badge(s: Status): string {
  if (s === 'ok') return ok('ok');
  if (s === 'unsupported') return dim('— n/a');
  if (s === 'missing') return yellow('✗ 缺失');
  return red(`✗ ${s}`);
}

export default async function doctor(client: ApiClient): Promise<void> {
  const codexHome = resolveCodexHome();
  const checks: HostCheck[] = [];

  // Claude
  const claudeSkill = path.join(os.homedir(), '.claude', 'skills', 'exomind', 'SKILL.md');
  const claudeSettings = path.join(os.homedir(), '.claude', 'settings.json');
  const claudeJson = path.join(os.homedir(), '.claude.json');
  checks.push({
    host: 'claude',
    skill: fileExists(claudeSkill) ? 'ok' : 'missing',
    hook: /exomind/.test(readText(claudeSettings)) ? 'ok' : 'missing',
    mcpConfig: mcpServersExomind(claudeJson, 'mcpServers') ? 'ok' : 'missing',
    paths: [claudeSkill, claudeSettings, claudeJson],
  });

  // Codex(skill + MCP,无 hook)
  const codexSkill = path.join(codexHome, 'skills', 'exomind', 'SKILL.md');
  const codexConfig = path.join(codexHome, 'config.toml');
  checks.push({
    host: 'codex',
    skill: fileExists(codexSkill) ? 'ok' : 'missing',
    hook: 'unsupported',
    mcpConfig: /^\[mcp_servers\.exomind\]\s*$/m.test(readText(codexConfig)) ? 'ok' : 'missing',
    paths: [codexSkill, codexConfig],
    detail: 'Codex 无 prompt-submit hook,靠 skill 触发(jdit/存档/查询)',
  });

  // OpenCode(仅 MCP)
  const ocJson = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
  checks.push({
    host: 'opencode',
    skill: 'unsupported',
    hook: 'unsupported',
    mcpConfig: mcpServersExomind(ocJson, 'mcp') ? 'ok' : 'missing',
    paths: [ocJson],
  });

  // 鉴权 + MCP initialize(stdio server 三宿主共用,查一次)
  let authed = false;
  let authErr = '';
  try {
    const me = (await client.get('/auth/me', { timeoutMs: 6000 })) as { authenticated?: boolean };
    authed = !!me.authenticated;
  } catch (e) {
    authErr = e instanceof Error ? e.message : String(e);
  }
  const mcpInit = await checkMcp();

  if (isJsonMode()) {
    console.log(
      JSON.stringify(
        {
          codexHome,
          hosts: checks,
          auth: { authenticated: authed, error: authErr || undefined },
          mcpInitialize: { ok: mcpInit.ok, detail: mcpInit.detail },
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(yellow('ExoMind 安装诊断:'));
  console.log(dim(`  Codex home: ${codexHome}`));
  for (const c of checks) {
    console.log(`  ${c.host}:  skill ${badge(c.skill)}  hook ${badge(c.hook)}  mcp ${badge(c.mcpConfig)}`);
    if (c.detail) console.log(dim(`    ${c.detail}`));
  }
  console.log(
    `  auth:        ${authed ? ok('✓ 已登录') : yellow('✗ 未登录/异常')}${authErr ? dim(' ' + authErr) : ''}`,
  );
  console.log(`  mcp init:    ${mcpInit.ok ? ok('✓ ' + mcpInit.detail) : yellow('✗ ' + mcpInit.detail)}`);
  console.log(dim('\n  缺项用 `exomind install [--host <claude|codex|opencode>]` 补齐;改完重启对应 Agent。'));
}

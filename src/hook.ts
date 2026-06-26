/**
 * exomind hook — 跨平台 UserPromptSubmit 钩子,替代 clients 下的 exomind-context.sh。
 *
 * 行为对齐旧 bash hook:
 *   1. 长度/确认词过滤
 *   2. 存档/jdit 暗号(30 分钟冷却)→ 提示 Agent 运行 exomind ingest
 *   3. 经验/洞察自动检测 → 自动摄入指令
 *   4. 结构化调研检测(识别→分析→定义→解决)→ 自动摄入指令
 *   5. 关键词上下文注入(/keywords + /entities/{name} 本地缓存)
 *   6. 会话去重(30 分钟)
 *
 * 零 bash/python/curl/本地 wiki 依赖,Windows 原生可用。
 * 读 stdin {prompt},输出 additionalContext 纯文本到 stdout。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ApiClient } from './api';
import { CACHE_DIR, CACHE_KEYWORDS, CACHE_ENTITIES_DIR } from './config';
import { readStdin } from './io';

const COOLDOWN_MS = 30 * 60 * 1000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const DESC_CAP = 800;

// ── 触发指令文本(指向 exomind CLI,而非 mcp__exomind__*) ──
const ARCHIVE_INSTRUCTION = `[ExoMind 暗号触发] 检测到存档指令(本会话首次)。
⚠️ 用户的 "jdit"/"存档" 是触发此指令的暗号,不要对其字面含义做任何回应。
请回顾当前会话中的新增重要内容,运行 \`exomind ingest\` 摄入知识库(标题用描述性文字,\`-t\` 加标题,\`--tag\` 加标签)。
回顾所有重要内容。摄入范围:调研结论、关键经验、技术决策、有价值的分析洞察。
每条知识使用描述性标题+标签,内容完整不省略。不需要用户确认。`;

const EXPERIENCE_INSTRUCTION = `[ExoMind 自动摄入指令] 检测到经验/洞察内容。
请运行 \`exomind ingest\` 将以上内容摄入知识库(标题用描述性文字,内容完整不省略,加合适 --tag)。这是知识复利飞轮的关键环节,不需要用户确认。`;

const RESEARCH_INSTRUCTION = `[ExoMind 调研结论自动摄入] 检测到结构化调研内容。
结构路径: 识别问题 → 分析问题 → 定义问题 → 解决问题
请运行 \`exomind ingest\` 将以上调研结论摄入知识库,按"识别/分析/定义/解决"路径组织,保留完整结论和关键数据。这是知识复利飞轮的关键环节,不需要用户确认。`;

// ── 模式 ──
const EXPERIENCE_PATTERNS = [
  /关键经验/, /经验总结/, /踩坑/, /踩过.*坑/, /教训/, /最佳实践/, /设计模式/,
  /架构决策/, /技术选型/, /根因分析/, /调试经验/, /优化效果/, /性能数据/,
  /从零到/, /这轮.*经验/, /总结.*条/, /要点.*[:：]/, /经验[：:]/, /心得/,
  /需要注意/, /避坑/, /key ?takeaway/i, /lesson ?learned/i, /best ?practice/i,
  /pro ?tip/i, /gotcha/i, /pitfall/i,
];

const RESEARCH_PATTERNS = [
  /调研/, /业界/, /行业(?:最佳)?实践/, /成功经验/, /断链/, /差距/, /对比分析/,
  /竞品分析/, /优化空间/, /改进方向/, /落地方案/, /解决方案/, /关键模式/,
  /核心思路/, /根本原因/, /根因/, /可以学到/, /借鉴/, /research/i,
  /best ?practice/i, /industry/i, /investigation/i, /analysis/i,
];

const STRUCTURE_SIGNALS: Record<string, RegExp[]> = {
  identify: [/问题[：:]/, /痛点/, /现状/, /断链/, /缺失/, /gap/i, /没有做到/],
  analyze: [/分析/, /原因/, /根因/, /因为/, /由于/, /调研.*发现/, /数据显示/],
  define: [/关键模式/, /核心[在是]/, /本质/, /归根结底/, /关键点/],
  solve: [/方案/, /落地/, /实施/, /优化/, /改进/, /解决/],
};

const CONFIRM_WORDS = new Set([
  '好', '继续', '是', '要', '不要', 'ok', 'yes', 'no', 'done', '跳过', '看看', '下一个', '继续吧', '可以',
]);

interface EntityDesc {
  name: string;
  type?: string;
  description?: string;
  aliases?: string[];
  relationships?: { type: string; entity: string; confidence?: number }[];
}

interface DedupState {
  injected: Record<string, number>;
  lastArchive: number;
}

function sessionKey(): string {
  return safe(process.env.CLAUDE_SESSION_ID || process.env.EXOMIND_SESSION_ID || 'default');
}

function dedupPath(): string {
  return path.join(CACHE_DIR, `dedup-${sessionKey()}.json`);
}

function safe(s: string): string {
  return s.replace(/[^a-zA-Z0-9一-龥._-]/g, '_').slice(0, 64);
}

function loadDedup(): DedupState {
  try {
    return JSON.parse(fs.readFileSync(dedupPath(), 'utf-8')) as DedupState;
  } catch {
    return { injected: {}, lastArchive: 0 };
  }
}

function saveDedup(d: DedupState): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(dedupPath(), JSON.stringify(d));
  } catch {
    /* 缓存写入失败不阻塞 */
  }
}

export function hasTechTerm(msg: string): boolean {
  return /`|```|\w+\.\w{1,5}\b|[A-Z][a-z]+[A-Z]|npm |pip |git |docker|api|http/i.test(msg);
}

export function isSecretWord(msg: string): boolean {
  const m = msg.trim();
  return /^(存档|jdit)[\s!!.。?？、]*$/i.test(m);
}

export function matchesExperience(msg: string): boolean {
  if (msg.length < 50) return false;
  let hits = 0;
  for (const re of EXPERIENCE_PATTERNS) if (re.test(msg)) hits++;
  const bullets = (msg.match(/^\s*([-*]|\d+[.、)])/gm) || []).length;
  return hits >= 1 || (bullets >= 3 && hasTechTerm(msg));
}

export function matchesResearch(msg: string): boolean {
  if (msg.length < 100) return false;
  let score = 0;
  for (const re of RESEARCH_PATTERNS) if (re.test(msg)) score++;
  let phases = 0;
  for (const sigs of Object.values(STRUCTURE_SIGNALS)) {
    if (sigs.some((r) => r.test(msg))) phases++;
  }
  const hasStructure = /(^|\n)\s*(#{1,4}\s|[-*]\s|\d+[.、)])/m.test(msg);
  return (score >= 2 && phases >= 3) || (score >= 3 && hasStructure && phases >= 2);
}

async function getKeywordIndex(
  client: ApiClient,
): Promise<{ names: string[]; aliases: string[] } | null> {
  try {
    const st = fs.statSync(CACHE_KEYWORDS);
    if (Date.now() - st.mtimeMs < CACHE_TTL_MS) {
      return JSON.parse(fs.readFileSync(CACHE_KEYWORDS, 'utf-8'));
    }
  } catch {
    /* 无缓存,刷新 */
  }
  try {
    const data = await client.get('/keywords');
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_KEYWORDS, JSON.stringify(data));
    return { names: data.names || [], aliases: data.aliases || [] };
  } catch {
    return null; // 无认证/网络 → 跳过注入
  }
}

async function getEntityDesc(client: ApiClient, name: string): Promise<EntityDesc> {
  const file = path.join(CACHE_ENTITIES_DIR, `${safe(name)}.json`);
  try {
    const st = fs.statSync(file);
    if (Date.now() - st.mtimeMs < CACHE_TTL_MS) {
      return JSON.parse(fs.readFileSync(file, 'utf-8')) as EntityDesc;
    }
  } catch {
    /* miss */
  }
  try {
    const ent = await client.get(`/entities/${encodeURIComponent(name)}`);
    const desc: EntityDesc = {
      name: ent.name || name,
      type: ent.type,
      description: ent.description || '',
      aliases: ent.aliases || [],
      relationships: (ent.relationships || []).slice(0, 5),
    };
    fs.mkdirSync(CACHE_ENTITIES_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(desc));
    return desc;
  } catch {
    return { name, description: '' };
  }
}

export function matchEntities(prompt: string, candidates: string[]): string[] {
  const lower = prompt.toLowerCase();
  const hits = new Set<string>();
  for (const name of candidates) {
    const nl = name.toLowerCase().trim();
    if (nl.length < 2) continue;
    if (lower.includes(nl)) hits.add(name);
  }
  // 较长的名称优先(更具体)
  return [...hits].sort((a, b) => b.length - a.length);
}

function contextBlock(ents: EntityDesc[]): string {
  if (!ents.length) return '';
  let out = '[ExoMind 知识库上下文] 以下是与当前话题相关的已有知识:\n\n';
  for (const e of ents) {
    const desc = (e.description || '(无描述)').slice(0, DESC_CAP);
    out += `### ${e.name}\n${desc}\n`;
    if (e.relationships && e.relationships.length) {
      out += '\n## Related\n';
      for (const r of e.relationships) out += `- [[${r.entity}]] (${r.type})\n`;
    }
    out += '\n';
  }
  out +=
    '以上知识已在上下文中,回答时可参考。如需更多详情,运行 `exomind query "<问题>"` 或 `exomind entity <名称>`。';
  return out;
}

async function buildContext(
  client: ApiClient,
  msg: string,
  dedup: DedupState,
  now: number,
): Promise<string> {
  const index = await getKeywordIndex(client);
  if (!index) return '';
  const candidates = [...(index.names || []), ...(index.aliases || [])];
  const matched = matchEntities(msg, candidates);
  if (!matched.length) return '';

  const picked: EntityDesc[] = [];
  for (const name of matched) {
    if (picked.length >= 3) break;
    // 会话去重:30 分钟内已注入的不再注入
    const canonical = name;
    if (dedup.injected[canonical] && now - dedup.injected[canonical] < COOLDOWN_MS) continue;
    const desc = await getEntityDesc(client, name);
    if (desc.description || desc.relationships?.length) {
      picked.push(desc);
      dedup.injected[canonical] = now;
    }
  }
  return contextBlock(picked);
}

export async function runHook(client: ApiClient): Promise<void> {
  const raw = await readStdin();
  if (!raw) return;

  let msg = '';
  try {
    const j = JSON.parse(raw) as { prompt?: string; message?: string };
    msg = (j.prompt || j.message || '').trim();
  } catch {
    msg = raw.trim();
  }
  if (!msg) return;

  const outputs: string[] = [];
  const dedup = loadDedup();
  const now = Date.now();

  const isSecret = isSecretWord(msg);

  // 1-2. 长度/确认词过滤
  if (!isSecret) {
    if (msg.length < 8) return;
    if (CONFIRM_WORDS.has(msg.toLowerCase())) return;
  }

  // 3. 存档/jdit 暗号(冷却)
  if (isSecret && msg.length < 20 && now - dedup.lastArchive > COOLDOWN_MS) {
    outputs.push(ARCHIVE_INSTRUCTION);
    dedup.lastArchive = now;
  } else if (!isSecret) {
    // 4. 经验 / 5. 调研
    if (matchesExperience(msg)) outputs.push(EXPERIENCE_INSTRUCTION);
    else if (matchesResearch(msg)) outputs.push(RESEARCH_INSTRUCTION);
  }

  // 6. 关键词上下文注入
  try {
    const ctx = await buildContext(client, msg, dedup, now);
    if (ctx) outputs.push(ctx);
  } catch {
    /* 注入失败不影响主流程 */
  }

  saveDedup(dedup);

  if (outputs.length) {
    process.stdout.write(outputs.join('\n\n') + '\n');
  }
}

/** exomind draft <action> — 草稿生成/列表/详情/更新/删除/发布知识飞轮/投递公众号。
 *  替代 gen_article.py(瘦客户端):new = generate + save 两步合一。
 *  格式契约:new 的选题串可附「## 原文」段(选题行\n## 原文\n正文)作为写作素材 ——
 *  服务端不解析该段,原样拼进 prompt 的「## 选题」块靠 LLM 识别,所以 CLI 侧负责:
 *  ① 落库前拒答检测(LLM 判「原文为空」的抱怨文绝不入库);② 生成前本地预检(原文段空则
 *  直接失败,省 1-3min LLM 调用),不把判空交给 LLM 自由发挥。 */
import type { ApiClient } from '../api';
import { opTimeout } from '../api';
import { readFileText, readStdinForced } from '../io';
import { output, ok, cyan, dim, yellow, bold, truncate, hint, isJsonMode } from '../format';
import * as readline from 'node:readline/promises';

type DraftOpts = Record<string, any>; // commander opts(宽松,内部按需取)

/** LLM 拒答特征(把「原文缺失」当正文返回的抱怨文)。命中即废弃,不落库。 */
const REFUSAL_RE = /原文为空|未提供原文|请粘贴|无法(读|找|获取)到?原文/;

interface SourceSection {
  /** 选题行(首行,用于诊断回显) */
  headline: string;
  /** 「## 原文」段是否存在 */
  hasSection: boolean;
  /** 原文正文字数(去空白);无段为 0 */
  sourceLen: number;
}

/** 本地解析选题串里的「## 原文」段 —— 服务端不解析,判空必须在这里做掉。 */
function parseSourceSection(topic: string): SourceSection {
  const headline = topic.split('\n', 1)[0].trim();
  const m = topic.match(/^##\s*原文\s*$/m);
  if (!m || m.index == null) return { headline, hasSection: false, sourceLen: 0 };
  let body = topic.slice(m.index + m[0].length);
  const next = body.match(/^##\s+\S/m); // 原文段到下一个 H2 为止
  if (next && next.index != null) body = body.slice(0, next.index);
  const src = body.trim().replace(/\s/g, '');
  return { headline, hasSection: true, sourceLen: src.length };
}

export default async function draft(client: ApiClient, opts: DraftOpts, args: string[]): Promise<void> {
  const action = args[0];
  switch (action) {
    case 'new':
      return doNew(client, opts, args.slice(1));
    case 'list':
      return doList(client, opts);
    case 'show':
      return doShow(client, args[1]);
    case 'update':
      return doUpdate(client, opts, args[1]);
    case 'delete':
      return doDelete(client, opts, args[1]);
    case 'publish':
      return doPublish(client, args[1]);
    case 'wechat':
      return doWechat(client, opts, args[1]);
    default:
      throw new Error(
        `未知 draft 子命令: ${action ?? '(空)'}。可用: new <选题> 生成 / list 列表 / show <id> 看正文 / update <id> 改标题或正文 / delete <id> 删除 / publish <id> 入库 / wechat <id> 投公众号`,
      );
  }
}

/** 读内容:new 用(--file 读整个选题串,"-"=stdin)。 */
async function readArgOrFile(opts: DraftOpts, args: string[]): Promise<string> {
  if (opts.file) return (opts.file === '-' ? await readStdinForced() : readFileText(opts.file)).trim();
  return args.join(' ').trim();
}

/** new: 生成草稿 + 保存(POST /generate-draft → POST /drafts,替代 gen_article.py)。 */
async function doNew(client: ApiClient, opts: DraftOpts, args: string[]): Promise<void> {
  const topic = await readArgOrFile(opts, args);
  if (!topic) {
    throw new Error(
      '请提供选题: exomind draft new "选题行\\n## 原文\\n<正文>" [--account <公众号>] [--file <path>]',
    );
  }

  // 0. 本地预检:「## 原文」段在但正文空 → 直接失败,不烧 1-3min LLM 调用。
  //    服务端不解析该段,判空交给 LLM 只会偶发误判成抱怨文(设计错误的本轮修复)。
  const src = parseSourceSection(topic);
  if (src.hasSection && src.sourceLen === 0) {
    throw new Error('「## 原文」段存在但正文为空 —— 请检查选题文件,或去掉该段改为纯选题生成');
  }
  if (!isJsonMode()) {
    hint(`选题: ${src.headline}${src.hasSection ? ` | 原文 ${src.sourceLen} 字` : ' | 无原文段(纯选题生成)'}`);
  }

  // 1. 生成(服务器 LLM,1-3min)
  const gen: Record<string, any> = await client.post(
    '/generate-draft',
    { topic, target_account: opts.account ?? null },
    { timeoutMs: opTimeout(300000) },
  );
  const content = String(gen.draft ?? '');
  if (!content) throw new Error('生成失败:响应无 draft 正文');

  // 1.5 拒答检测:LLM 把「原文为空,请粘贴正文」当正文返回时绝不落库
  //     (此前只判 !content,抱怨文被保存成废稿且删不掉)。
  if (REFUSAL_RE.test(content)) {
    throw new Error(`生成失败:LLM 判定原文缺失(拒答),草稿未保存。返回内容: ${truncate(content, 120)}`);
  }

  // title: 正文 H1 → title_candidates[0] → topic
  const h1 = content.match(/^#\s+(.+?)\s*$/m);
  const title = h1?.[1] || (Array.isArray(gen.title_candidates) ? String(gen.title_candidates[0]) : '') || topic;

  // 2. 保存(/generate-draft 不自动保存,必须显式 POST /drafts;类型对齐)
  const saved: Record<string, any> = await client.post(
    '/drafts',
    {
      title,
      topic,
      content,
      tags: Array.isArray(gen.tags) ? gen.tags : [],
      sources: Array.isArray(gen.sources) ? gen.sources.map(String) : [],
      insights: gen.insights != null ? String(gen.insights) : '',
      confidence: Number(gen.confidence) || 0,
      target_account: opts.account ?? gen.target_account ?? null,
      recommended_account: gen.recommended_account ?? null,
      routing_reason: gen.routing_reason ?? null,
      title_candidates: Array.isArray(gen.title_candidates) ? gen.title_candidates.map(String) : [],
    },
    { timeoutMs: opTimeout(60000) },
  );
  const draftId = String(saved.id ?? '');

  output({ ...gen, id: draftId, title, content }, () => {
    console.log(ok('✓ 草稿已生成并保存'));
    console.log(dim(`  id: ${draftId}`));
    console.log(dim(`  标题: ${title}`));
    if (gen.recommended_account) {
      console.log(dim(`  推荐公众号: ${gen.recommended_account}${gen.routing_reason ? ` (${gen.routing_reason})` : ''}`));
    }
    console.log(dim(`  正文预览: ${truncate(content, 200)}`));
    console.log(dim(`  下一步: exomind draft show ${draftId} | publish ${draftId} | wechat ${draftId} --account <号>`));
  });
}

async function doList(client: ApiClient, opts: DraftOpts): Promise<void> {
  const r: Record<string, any> = await client.get('/drafts', {
    status: opts.status,
    page: Number(opts.page ?? 1),
    page_size: Number(opts.size ?? 20),
  });
  const items: Record<string, any>[] = r.drafts || [];
  output(r, () => {
    console.log(cyan(`草稿列表 (共 ${r.total ?? items.length}):`));
    if (!items.length) console.log(dim('  (无)'));
    items.forEach((d, i) => {
      console.log(`\n  ${i + 1}. ${bold(String(d.title ?? ''))} ${dim(`[${d.status ?? 'draft'}]`)}`);
      console.log(dim(`     id: ${d.id}`));
      if (d.recommended_account) console.log(dim(`     推荐号: ${d.recommended_account}`));
    });
  });
}

async function doShow(client: ApiClient, id: string | undefined): Promise<void> {
  if (!id) throw new Error('请提供 draft id: exomind draft show <id>');
  const d: Record<string, any> = await client.get(`/drafts/${encodeURIComponent(id)}`);
  output(d, () => {
    console.log(bold(String(d.title ?? '')));
    console.log(dim(`  id: ${d.id} | status: ${d.status} | 字数: ${d.word_count ?? '?'}`));
    if (d.recommended_account) console.log(dim(`  推荐公众号: ${d.recommended_account}`));
    console.log(dim('  ---'));
    console.log(String(d.content ?? ''));
  });
}

/** update: 原地改草稿(PUT /drafts/{id},--title 改标题 / --file 换正文,"-"=stdin)。 */
async function doUpdate(client: ApiClient, opts: DraftOpts, id: string | undefined): Promise<void> {
  if (!id) throw new Error('请提供 draft id: exomind draft update <id> --file <path> | --title <新标题>');
  const body: Record<string, unknown> = {};
  if (opts.title) body.title = String(opts.title);
  if (opts.file) body.content = opts.file === '-' ? await readStdinForced() : readFileText(opts.file);
  if (!Object.keys(body).length) {
    throw new Error('至少提供 --title <新标题> 或 --file <新正文路径> 之一');
  }
  const r: Record<string, any> = await client.put(
    `/drafts/${encodeURIComponent(id)}`,
    body,
    { timeoutMs: opTimeout(60000) },
  );
  output(r, () => {
    console.log(ok(`✓ 草稿已更新: ${id}`));
    console.log(dim(`  改动: ${Object.keys(body).join(' + ')}`));
  });
}

/** delete: 删草稿(服务端先归档到 .exo/drafts_archive.jsonl 再删,误删可从归档恢复)。 */
async function doDelete(client: ApiClient, opts: DraftOpts, id: string | undefined): Promise<void> {
  if (!id) throw new Error('请提供 draft id: exomind draft delete <id> [-y]');
  // 先取详情:确认问句里带上标题,顺带提前暴露 404
  const d: Record<string, any> = await client.get(`/drafts/${encodeURIComponent(id)}`);
  if (!opts.yes && !isJsonMode()) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ans = await rl.question(`删除草稿「${d.title ?? id}」？[y/N] `);
    rl.close();
    if (ans.trim().toLowerCase() !== 'y') {
      console.log('已取消');
      return;
    }
  }
  await client.del(`/drafts/${encodeURIComponent(id)}`, { timeoutMs: opTimeout(60000) });
  output({ deleted: true, id, title: d.title }, () => {
    console.log(ok(`✓ 已删除草稿: ${d.title ?? id}`));
    console.log(dim('  服务端已归档(.exo/drafts_archive.jsonl),误删可恢复'));
  });
}

async function doPublish(client: ApiClient, id: string | undefined): Promise<void> {
  if (!id) throw new Error('请提供 draft id: exomind draft publish <id>');
  const r: Record<string, any> = await client.post(
    `/drafts/${encodeURIComponent(id)}/publish`,
    {},
    { timeoutMs: opTimeout(300000) },
  );
  output(r, () => {
    console.log(ok('✓ 已发布到知识飞轮'));
    if (r.summary) console.log(dim(`  ${r.summary}`));
    if (r.entities != null) console.log(dim(`  实体 ${r.entities} / 概念 ${r.concepts ?? 0}`));
  });
}

async function doWechat(client: ApiClient, opts: DraftOpts, id: string | undefined): Promise<void> {
  if (!id) throw new Error('请提供 draft id: exomind draft wechat <id> --account <号>');
  if (!opts.account) throw new Error('请提供 --account: exomind draft wechat <id> --account <公众号>');
  const r: Record<string, any> = await client.post(
    `/drafts/${encodeURIComponent(id)}/submit-wechat`,
    {
      account: opts.account,
      digest: opts.digest,
      author: opts.author,
      cover: opts.cover,
      ...(opts.coverPrompt ? { cover_image_prompt: opts.coverPrompt } : {}),
    },
    { timeoutMs: opTimeout(120000) },
  );
  output(r, () => {
    console.log(ok('✓ 已投递公众号草稿箱'));
    if (r.message) console.log(dim(`  ${r.message}`));
    if (r.media_id) console.log(dim(`  media_id: ${r.media_id}`));
    console.log(yellow('  下一步: 登录公众号后台 → 草稿箱 → 群发'));
  });
}

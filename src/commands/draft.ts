/** exomind draft <action> — 草稿生成/列表/详情/发布知识库/投递公众号。
 *  替代 gen_article.py(瘦客户端):new = generate + save 两步合一。 */
import type { ApiClient } from '../api';
import { opTimeout } from '../api';
import { output, ok, cyan, dim, yellow, bold, truncate } from '../format';

type DraftOpts = Record<string, any>; // commander opts(宽松,内部按需取)

export default async function draft(client: ApiClient, opts: DraftOpts, args: string[]): Promise<void> {
  const action = args[0];
  switch (action) {
    case 'new':
      return doNew(client, opts, args.slice(1));
    case 'list':
      return doList(client, opts);
    case 'show':
      return doShow(client, args[1]);
    case 'publish':
      return doPublish(client, args[1]);
    case 'wechat':
      return doWechat(client, opts, args[1]);
    default:
      throw new Error(
        `未知 draft 子命令: ${action ?? '(空)'}。可用: new <选题> 生成 / list 列表 / show <id> 看正文 / publish <id> 入库 / wechat <id> 投公众号`,
      );
  }
}

/** new: 生成草稿 + 保存(POST /generate-draft → POST /drafts,替代 gen_article.py)。 */
async function doNew(client: ApiClient, opts: DraftOpts, args: string[]): Promise<void> {
  const topic = args.join(' ').trim();
  if (!topic) throw new Error('请提供选题: exomind draft new "选题" [--account <公众号>]');

  // 1. 生成(服务器 LLM,1-3min)
  const gen: Record<string, any> = await client.post(
    '/generate-draft',
    { topic, target_account: opts.account ?? null },
    { timeoutMs: opTimeout(300000) },
  );
  const content = String(gen.draft ?? '');
  if (!content) throw new Error('生成失败:响应无 draft 正文');

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

async function doPublish(client: ApiClient, id: string | undefined): Promise<void> {
  if (!id) throw new Error('请提供 draft id: exomind draft publish <id>');
  const r: Record<string, any> = await client.post(
    `/drafts/${encodeURIComponent(id)}/publish`,
    {},
    { timeoutMs: opTimeout(300000) },
  );
  output(r, () => {
    console.log(ok('✓ 已发布到知识库'));
    if (r.summary) console.log(dim(`  ${r.summary}`));
    if (r.entities != null) console.log(dim(`  实体 ${r.entities} / 概念 ${r.concepts ?? 0}`));
  });
}

async function doWechat(client: ApiClient, opts: DraftOpts, id: string | undefined): Promise<void> {
  if (!id) throw new Error('请提供 draft id: exomind draft wechat <id> --account <号>');
  if (!opts.account) throw new Error('请提供 --account: exomind draft wechat <id> --account <公众号>');
  const r: Record<string, any> = await client.post(
    `/drafts/${encodeURIComponent(id)}/submit-wechat`,
    { account: opts.account, digest: opts.digest, author: opts.author },
    { timeoutMs: opTimeout(120000) },
  );
  output(r, () => {
    console.log(ok('✓ 已投递公众号草稿箱'));
    if (r.message) console.log(dim(`  ${r.message}`));
    if (r.media_id) console.log(dim(`  media_id: ${r.media_id}`));
    console.log(yellow('  下一步: 登录公众号后台 → 草稿箱 → 群发'));
  });
}

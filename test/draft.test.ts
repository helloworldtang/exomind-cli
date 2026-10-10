import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ApiClient } from '../src/api';
import draft from '../src/commands/draft';

const origFetch = global.fetch;

/** mock fetch，捕获请求 url/method 与解析后的 JSON body，按路由返回固定响应。 */
function capture(
  routes: Record<string, unknown> = {},
): { url: () => string; method: () => string; body: () => Record<string, unknown>; calls: string[] } {
  let u = '';
  let m = '';
  let b: Record<string, unknown> = {};
  const calls: string[] = [];
  global.fetch = (async (url: string, init?: RequestInit) => {
    u = url;
    m = init?.method ?? 'GET';
    calls.push(`${m} ${url}`);
    b = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
    const key = `${m} ${String(url).replace('https://x.test', '')}`;
    if (key in routes) {
      const r = routes[key];
      return new Response(typeof r === 'string' ? r : JSON.stringify(r), { status: 200 });
    }
    return new Response(JSON.stringify({ success: true, media_id: 'M1' }), { status: 200 });
  }) as typeof fetch;
  return { url: () => u, method: () => m, body: () => b, calls };
}

/** 兼容旧用法:只关心最后一个 POST。 */
function capturePost(): { url: () => string; body: () => Record<string, unknown> } {
  const c = capture();
  return { url: c.url, body: c.body };
}

afterEach(() => {
  global.fetch = origFetch;
});

const client = () => new ApiClient({ base_url: 'https://x.test', api_key: 'sk_test' });

const tmpFile = (content: string): string => {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'draft-')), 't.md');
  fs.writeFileSync(p, content, 'utf-8');
  return p;
};

describe('draft new 生成/落库护栏', () => {
  test('拒答文(原文为空/请粘贴)不落库:POST /drafts 不被调用', async () => {
    const cap = capture({
      'POST /generate-draft': { draft: '原文为空，无法生成文章，请粘贴正文后再试。', title_candidates: ['x'] },
    });
    await assert.rejects(
      () => draft(client(), {}, ['new', '某选题']),
      /拒答|未保存/,
    );
    assert.equal(cap.calls.some((c) => c === 'POST https://x.test/drafts'), false);
  });

  // 以下变体全部来自 2026-10 清理存量废稿时的真实样本(26 份抱怨文,窄正则只拦得住 3 份)
  test('拒答变体「原文未提供」被拦(长度+关键词判据)', async () => {
    const cap = capture({
      'POST /generate-draft': { draft: '原文未提供。 `## 原文` 下没有内容，无法做最小改动修正。' },
    });
    await assert.rejects(() => draft(client(), {}, ['new', '某选题']), /拒答/);
    assert.equal(cap.calls.some((c) => c === 'POST https://x.test/drafts'), false);
  });

  test('拒答变体「原文好像没有贴上来」被拦', async () => {
    const cap = capture({
      'POST /generate-draft': { draft: '原文好像没有贴上来——你这里"## 原文"下面是空的，我没法直接改。' },
    });
    await assert.rejects(() => draft(client(), {}, ['new', '某选题']), /拒答/);
  });

  test('长正文提及「原文/正文」不误杀(400 字硬上限)', async () => {
    const long = '这是一篇真正的长文章,虽然正文里提到原文两个字。'.repeat(30); // ~1000 字
    const cap = capture({
      'POST /generate-draft': { draft: `# 标题\n\n${long}`, title_candidates: ['标题'] },
    });
    await draft(client(), {}, ['new', '某选题']);
    assert.equal(cap.calls.some((c) => c === 'POST https://x.test/drafts'), true);
  });

  test('「## 原文」段空 → 预检失败,不调 /generate-draft(省 LLM 调用)', async () => {
    const cap = capture();
    await assert.rejects(
      () => draft(client(), {}, ['new', '选题行\n## 原文\n']),
      /正文为空/,
    );
    assert.equal(cap.calls.length, 0);
  });

  test('「## 原文」段有正文 → 正常透传 topic 且落库', async () => {
    const cap = capture({
      'POST /generate-draft': { draft: `# 标题\n\n${'这是一篇够长的正文,过得了拒答长度判据。'.repeat(30)}`, title_candidates: ['标题'] },
    });
    await draft(client(), {}, ['new', '选题行\n## 原文\n这是原文内容,足够长。']);
    const gen = cap.calls.find((c) => c.startsWith('POST https://x.test/generate-draft'));
    assert.ok(gen);
    const save = cap.calls.find((c) => c === 'POST https://x.test/drafts');
    assert.ok(save, '落库 POST /drafts 应被调用');
  });

  test('--file 读选题文件(绕 argv 限制)', async () => {
    const cap = capture({
      'POST /generate-draft': { draft: `# 标题\n\n${'这是一篇够长的正文,过得了拒答长度判据。'.repeat(30)}` },
    });
    const f = tmpFile('文件选题行\n## 原文\n文件里的原文素材。');
    await draft(client(), { file: f }, ['new']);
    assert.equal((cap.body() as any).topic, '文件选题行\n## 原文\n文件里的原文素材。');
  });
});

describe('draft delete / update', () => {
  test('delete -y:先 GET 详情再 DELETE,不再确认', async () => {
    const cap = capture({
      'GET /drafts/d9': { id: 'd9', title: '废稿', content: 'x' },
      'DELETE /drafts/d9': { deleted: true },
    });
    await draft(client(), { yes: true }, ['delete', 'd9']);
    assert.deepEqual(cap.calls, ['GET https://x.test/drafts/d9', 'DELETE https://x.test/drafts/d9']);
  });

  test('delete 缺 id 抛错', async () => {
    await assert.rejects(() => draft(client(), { yes: true }, ['delete']), /draft id/);
  });

  test('update --title --file:PUT 透传两字段', async () => {
    const cap = capture({ 'PUT /drafts/d7': { id: 'd7', updated: true } });
    const f = tmpFile('# 改后正文\n\n内容');
    await draft(client(), { title: '新标题', file: f }, ['update', 'd7']);
    assert.equal(cap.method(), 'PUT');
    assert.equal(cap.body().title, '新标题');
    assert.equal(cap.body().content, '# 改后正文\n\n内容');
  });

  test('update 无任何字段抛错', async () => {
    await assert.rejects(() => draft(client(), {}, ['update', 'd7']), /--title|--file/);
  });
});

describe('draft wechat 投递', () => {
  test('正文是抱怨文 → 拒投,submit-wechat 不被调用(出口侧护栏)', async () => {
    const cap = capture({
      'GET /drafts/d1': { id: 'd1', title: '正经标题', content: '原文未提供。## 原文 下没有内容，无法做最小改动修正。' },
    });
    await assert.rejects(
      () => draft(client(), { account: 'ailang', cover: 'ai' }, ['wechat', 'd1']),
      /拒答抱怨文/,
    );
    assert.equal(cap.calls.some((c) => c.endsWith('/drafts/d1/submit-wechat')), false);
  });

  test('publish 正文是抱怨文 → 拒发', async () => {
    const cap = capture({
      'GET /drafts/d2': { id: 'd2', title: 't', content: '原文内容为空，请把需要润色的正文贴过来。' },
    });
    await assert.rejects(() => draft(client(), {}, ['publish', 'd2']), /拒答抱怨文/);
    assert.equal(cap.calls.some((c) => c.endsWith('/drafts/d2/publish')), false);
  });

  test('默认 cover=ai 透传给服务端', async () => {
    const cap = capturePost();
    await draft(client(), { account: 'ailang', cover: 'ai' }, ['wechat', 'd1']);
    assert.equal(cap.url(), 'https://x.test/drafts/d1/submit-wechat');
    assert.equal(cap.body().account, 'ailang');
    assert.equal(cap.body().cover, 'ai');
    assert.equal('cover_image_prompt' in cap.body(), false); // 空则不传
    assert.equal('generate_cover' in cap.body(), false); // 旧字段不传
  });

  test('--cover-prompt 透传为 cover_image_prompt', async () => {
    const cap = capturePost();
    await draft(client(), { account: 'ailang', cover: 'ai', coverPrompt: '水彩橘猫看雨' }, ['wechat', 'd1']);
    assert.equal(cap.body().cover_image_prompt, '水彩橘猫看雨');
  });

  test('--cover provided 透传（旧值 config/default 也直接透传，服务端归一）', async () => {
    const cap = capturePost();
    await draft(client(), { account: 'ailang', cover: 'provided' }, ['wechat', 'd1']);
    assert.equal(cap.body().cover, 'provided');
  });

  test('cover_image_prompt 缺省时不传该字段', async () => {
    const cap = capturePost();
    await draft(client(), { account: 'ailang', cover: 'ai', coverPrompt: undefined }, ['wechat', 'd1']);
    assert.equal('cover_image_prompt' in cap.body(), false);
  });

  test('缺 --account 抛错', async () => {
    await assert.rejects(() => draft(client(), { cover: 'ai' }, ['wechat', 'd1']), /account/);
  });

  test('缺 draft id 抛错', async () => {
    await assert.rejects(() => draft(client(), { account: 'ailang', cover: 'ai' }, ['wechat']), /draft id/);
  });
});

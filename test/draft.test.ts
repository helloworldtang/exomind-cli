import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient } from '../src/api';
import draft from '../src/commands/draft';

const origFetch = global.fetch;

/** mock fetch，捕获请求 url 与解析后的 JSON body，返回固定的投递成功响应。 */
function capturePost(): { url: () => string; body: () => Record<string, unknown> } {
  let u = '';
  let b: Record<string, unknown> = {};
  global.fetch = (async (url: string, init?: RequestInit) => {
    u = url;
    b = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
    return new Response(JSON.stringify({ success: true, media_id: 'M1' }), { status: 200 });
  }) as typeof fetch;
  return { url: () => u, body: () => b };
}

afterEach(() => {
  global.fetch = origFetch;
});

const client = () => new ApiClient({ base_url: 'https://x.test', api_key: 'sk_test' });

describe('draft wechat 投递', () => {
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

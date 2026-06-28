import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient } from '../src/api';
import { handleMessage, TOOLS } from '../src/mcp';

const origFetch = global.fetch;
function mockFetch(impl: (url: string) => { ok: boolean; status: number; statusText?: string; text: () => Promise<string> }): void {
  global.fetch = ((url: string) => Promise.resolve(impl(url))) as typeof fetch;
}
afterEach(() => {
  global.fetch = origFetch;
});

const client = () => new ApiClient({ base_url: 'https://x.test', api_key: 'k' });

describe('mcp: 协议握手', () => {
  test('initialize 返回协议版本与 serverInfo', async () => {
    const r = await handleMessage(client(), { jsonrpc: '2.0', id: 1, method: 'initialize' });
    assert.equal((r as { result: { protocolVersion: string } }).result.protocolVersion, '2024-11-05');
    assert.equal((r as { result: { serverInfo: { name: string } } }).result.serverInfo.name, 'exomind');
  });

  test('notifications/initialized → null(通知不回复)', async () => {
    const r = await handleMessage(client(), { jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.equal(r, null);
  });

  test('ping → 空 result', async () => {
    const r = await handleMessage(client(), { jsonrpc: '2.0', id: 2, method: 'ping' });
    assert.deepEqual((r as { result: unknown }).result, {});
  });

  test('未知方法 → JSON-RPC error -32601', async () => {
    const r = (await handleMessage(client(), { jsonrpc: '2.0', id: 3, method: 'nope' })) as {
      error: { code: number };
    };
    assert.equal(r.error.code, -32601);
  });
});

describe('mcp: tools/list', () => {
  test('包含核心工具', () => {
    const names = TOOLS.map((t) => t.name);
    for (const n of ['ingest', 'query', 'search', 'entity', 'relations', 'stats']) {
      assert.ok(names.includes(n), `应有 ${n}`);
    }
  });

  test('tools/list 返回工具数组', async () => {
    const r = await handleMessage(client(), { jsonrpc: '2.0', id: 4, method: 'tools/list' });
    const tools = (r as { result: { tools: { name: string }[] } }).result.tools;
    assert.ok(tools.length >= 6);
  });
});

describe('mcp: tools/call', () => {
  test('stats 正常返回 JSON 文本', async () => {
    mockFetch(() => ({ ok: true, status: 200, text: async () => JSON.stringify({ total_nodes: 100 }) }));
    const r = await handleMessage(client(), {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'stats', arguments: {} },
    });
    const content = (r as { result: { content: { type: string; text: string }[] } }).result.content[0];
    assert.equal(content.type, 'text');
    assert.equal(JSON.parse(content.text).total_nodes, 100);
  });

  test('search 拼接 query 并请求 /search', async () => {
    let called = '';
    mockFetch((url) => {
      called = url;
      return { ok: true, status: 200, text: async () => JSON.stringify({ results: [] }) };
    });
    await handleMessage(client(), {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'search', arguments: { keyword: 'redis', limit: 5 } },
    });
    assert.match(called, /\/search\?/);
    assert.match(called, /q=redis/);
    assert.match(called, /limit=5/);
  });

  test('工具执行失败 → isError:true(非 JSON-RPC error)', async () => {
    mockFetch(() => ({ ok: false, status: 401, statusText: 'Unauthorized', text: async () => JSON.stringify({ detail: 'bad key' }) }));
    const r = (await handleMessage(client(), {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'stats', arguments: {} },
    })) as { result: { isError: boolean; content: { text: string }[] } };
    assert.equal(r.result.isError, true);
    assert.match(r.result.content[0].text, /401|bad key/);
  });
});

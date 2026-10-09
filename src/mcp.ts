/**
 * exomind mcp — 本地 stdio MCP server,把核心命令暴露为 typed tool。
 * 补 ExoMind 的「能力层(MCP 工具)」,让 Agent 用确定性的 tool call
 * 而非"读 skill → 拼 bash"。跨宿主(Claude Code/OpenCode/Cursor)同一配置:
 *   { "command": "exomind", "args": ["mcp"] }
 * 复用 CLI 的 ApiClient(同一份 ~/.exomind/config.json 凭证),无需子进程。
 */
import * as readline from 'node:readline';
import pkg from '../package.json' assert { type: 'json' };
import { ApiClient, opTimeout } from './api';

const PROTOCOL_VERSION = '2024-11-05';

type JsonRpc = { jsonrpc: '2.0'; id: unknown; result?: unknown; error?: { code: number; message: string } };

/** 暴露给宿主的工具集合(核心读写;可按需扩展)。 */
export const TOOLS = [
  {
    name: 'ingest',
    description: '向 ExoMind 知识飞轮导入知识(文本),自动抽取实体/关系。',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '要导入的文本内容' },
        title: { type: 'string', description: '标题(可选)' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签(可选)' },
      },
      required: ['content'],
    },
  },
  {
    name: 'query',
    description: 'LLM 问答:基于知识飞轮回答问题。',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '问题' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签过滤(可选)' },
      },
      required: ['question'],
    },
  },
  {
    name: 'search',
    description: '全文搜索知识飞轮。',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '关键词' },
        limit: { type: 'integer', description: '返回数量(默认 10)' },
      },
      required: ['keyword'],
    },
  },
  {
    name: 'entity',
    description: '获取实体详情(描述、别名、关系)。',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: '实体名称' } },
      required: ['name'],
    },
  },
  {
    name: 'relations',
    description: '获取实体的关联实体(可达性)。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '实体名称' },
        depth: { type: 'integer', description: '深度 1-3(默认 1)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'stats',
    description: '知识飞轮统计(节点/关系数)。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'review',
    description: 'FSRS-5 间隔复习:取当前待复习的知识卡列表(实体名/类型/超期天数)。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: '返回条数(默认 12)' },
      },
    },
  },
  {
    name: 'review_mark',
    description: '标记一条复习结果(FSRS-5 评分,复习后调用)。rating: 1=忘记 2=吃力 3=顺利 4=轻松。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '实体名称(来自 review 返回的 name)' },
        rating: { type: 'integer', description: '1-4: 1=忘记 2=吃力 3=顺利 4=轻松' },
      },
      required: ['name', 'rating'],
    },
  },
  {
    name: 'synthesize',
    description: '围绕一个主题综合知识飞轮中的相关页面,生成结构化综述(长时操作,数十秒到数分钟)。',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: '主题(实体名或关键词)' },
        depth: { type: 'integer', description: '综合深度 1-3(默认 2)' },
      },
      required: ['topic'],
    },
  },
  {
    name: 'topics',
    description: '建议接下来值得摄入/深挖的主题(基于知识飞轮当前结构与热度)。',
    inputSchema: {
      type: 'object',
      properties: {
        count: { type: 'integer', description: '返回条数(默认 5)' },
      },
    },
  },
  {
    name: 'daily',
    description: '今日简报:知识飞轮近 N 天的增长/发现摘要。',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'integer', description: '回看天数(默认 1)' },
      },
    },
  },
  {
    name: 'gaps',
    description: '知识缺口:近 N 天查询/使用中暴露但知识飞轮未覆盖的主题(驱动下一步摄入)。',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'integer', description: '统计窗口天数(默认 30)' },
      },
    },
  },
];

/** MCP 入参是 JSON 任意值,转 query 参数前先收窄类型(schema 已校验,这里是防御)。 */
function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function num(v: unknown, dflt: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
}

/** 单个工具的执行(复用 ApiClient,走与 CLI 完全相同的 REST)。 */
async function handleTool(client: ApiClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'ingest':
      return client.post('/ingest', args, { timeoutMs: opTimeout(300000) });
    case 'query':
      return client.post('/query', args, { timeoutMs: opTimeout(180000) });
    case 'search':
      return client.get('/search', { q: str(args.keyword ?? args.q), limit: num(args.limit, 10) });
    case 'entity':
      return client.get(`/entities/${encodeURIComponent(String(args.name))}`);
    case 'relations':
      return client.get(`/relations/${encodeURIComponent(String(args.name))}`, { depth: num(args.depth, 1) });
    case 'stats':
      return client.get('/stats');
    case 'review':
      return client.get('/review', { limit: num(args.limit, 12) });
    case 'review_mark': {
      const rating = num(args.rating, 3);
      if (rating < 1 || rating > 4) throw new Error('rating 必须是 1-4 (1=忘记 2=吃力 3=顺利 4=轻松)');
      // /review/mark 用 query 参数(与 CLI review mark 同源)
      return client.request('POST', '/review/mark', {
        query: { name: str(args.name), rating },
      });
    }
    case 'synthesize':
      return client.post('/synthesize', { topic: str(args.topic), depth: num(args.depth, 2) }, { timeoutMs: opTimeout(300000) });
    case 'topics':
      return client.get('/suggest-topics', { count: num(args.count, 5) });
    case 'daily':
      return client.get('/daily-summary', { days: num(args.days, 1) });
    case 'gaps':
      return client.get('/knowledge-gaps', { days: num(args.days, 30) });
    default:
      throw new Error(`未知工具: ${name}`);
  }
}

/** 处理一条 JSON-RPC 消息,返回响应(或 null 表示通知,无需回复)。可单测。 */
export async function handleMessage(client: ApiClient, msg: { id?: unknown; method?: string; params?: unknown }): Promise<JsonRpc | null> {
  const id = msg.id;
  const method = msg.method;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'exomind', version: pkg.version },
      },
    };
  }
  if (method === 'notifications/initialized' || method === 'initialized') return null;
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOLS } };

  if (method === 'tools/call') {
    const params = (msg.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
    try {
      const data = await handleTool(client, params.name ?? '', params.arguments ?? {});
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
        },
      };
    } catch (e) {
      // 工具执行错误 → isError(MCP 规范:工具错误用 isError,不是 JSON-RPC error)
      const message = e instanceof Error ? e.message : String(e);
      return {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: `错误: ${message}` }], isError: true },
      };
    }
  }

  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } };
}

/** 启动 stdio MCP server:逐行读 JSON-RPC,处理后写回 stdout。 */
export async function runMcpServer(client: ApiClient): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: Parameters<typeof handleMessage>[1];
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return; // 非 JSON,忽略
    }
    try {
      const resp = await handleMessage(client, msg);
      if (resp) process.stdout.write(JSON.stringify(resp) + '\n');
    } catch (e) {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: (msg as { id?: unknown })?.id ?? null,
          error: { code: -32603, message: e instanceof Error ? e.message : String(e) },
        }) + '\n',
      );
    }
  });
  return new Promise<void>((resolve) => {
    rl.on('close', () => resolve());
  });
}

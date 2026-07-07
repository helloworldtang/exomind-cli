/** HTTP 客户端: 基于 Node 18+ 全局 fetch,统一 Bearer 认证 + 错误归一。 */
import type { Config } from './config';

/** 长操作超时(ingest/query/synthesize): 优先 EXOMIND_TIMEOUT_MS 环境变量,否则用默认值。 */
export function opTimeout(defaultMs: number): number {
  const n = Number(process.env.EXOMIND_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : defaultMs;
}

export class ApiError extends Error {
  status: number;
  detail: string;
  headers: Record<string, string>;
  body: any;
  constructor(
    status: number,
    detail: string,
    headers: Record<string, string> = {},
    body: any = null,
  ) {
    super(`HTTP ${status}: ${detail}`);
    this.status = status;
    this.detail = detail;
    this.headers = headers;
    this.body = body;
  }
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  timeoutMs?: number;
  text?: boolean; // 返回原始文本而非 JSON
}

type QueryValue = string | number | boolean | undefined | null;

export class ApiClient {
  constructor(private cfg: Config) {}

  private ensureKey(): void {
    if (!this.cfg.api_key) {
      throw new ApiError(401, '未登录。请先运行 `exomind login`,或设置环境变量 EXOMIND_API_KEY。');
    }
  }

  private buildUrl(p: string, query?: Record<string, QueryValue>): string {
    const base = this.cfg.base_url.replace(/\/+$/, '');
    const path_ = p.startsWith('/') ? p : `/${p}`;
    let u = `${base}${path_}`;
    if (query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') params.append(k, String(v));
      }
      const qs = params.toString();
      if (qs) u += `?${qs}`;
    }
    return u;
  }

  async request(method: string, p: string, opts: RequestOptions = {}): Promise<any> {
    this.ensureKey();
    const controller = new AbortController();
    const timeout = opts.timeoutMs ?? 30000;
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(this.buildUrl(p, opts.query), {
        method,
        headers: {
          Authorization: `Bearer ${this.cfg.api_key}`,
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        const headers: Record<string, string> = {};
        res.headers?.forEach((v, k) => {
          headers[k.toLowerCase()] = v;
        });
        let detail = text || res.statusText;
        let body: any = null;
        try {
          body = JSON.parse(text);
          detail = body.detail || body.message || JSON.stringify(body);
        } catch {
          /* 保留原始文本 */
        }
        throw new ApiError(res.status, String(detail).slice(0, 800), headers, body);
      }
      if (opts.text) return text;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    } catch (e: any) {
      if (e instanceof ApiError) throw e;
      if (e?.name === 'AbortError') {
        throw new ApiError(0, `请求超时 (${timeout}ms): ${method} ${p}`);
      }
      throw new ApiError(0, `网络错误: ${e?.message || String(e)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  get(p: string, query?: Record<string, QueryValue>, opts?: Omit<RequestOptions, 'query' | 'body'>): Promise<any> {
    return this.request('GET', p, { ...opts, query });
  }

  post(p: string, body?: unknown, opts?: Omit<RequestOptions, 'body' | 'query'>): Promise<any> {
    return this.request('POST', p, { ...opts, body });
  }
}

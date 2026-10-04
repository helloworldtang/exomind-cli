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
  /** true = 客户端主动超时中止(AbortError),非网络故障;重试只会再等一个满超时,不重试。 */
  timedOut?: boolean;
  constructor(
    status: number,
    detail: string,
    headers: Record<string, string> = {},
    body: any = null,
    timedOut = false,
  ) {
    super(`HTTP ${status}: ${detail}`);
    this.status = status;
    this.detail = detail;
    this.headers = headers;
    this.body = body;
    this.timedOut = timedOut;
  }
}

/** 瞬时错误(502/503/504/网络故障,不含超时与 429):值得退避重试。
 *  429 不在此列——限流是"稍等再来",由调用方按 Retry-After 处理(retryWith429)。 */
export function isTransientError(e: unknown): boolean {
  return (
    e instanceof ApiError &&
    ([502, 503, 504].includes(e.status) || (e.status === 0 && !e.timedOut))
  );
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 瞬时错误(502/503/504/网络/超时)指数退避重试(1s/2s…,默认 3 次)。
 *  注:此函数把超时(status 0 含 AbortError)也当瞬时——供显式控制超时的调用方用;
 *  ApiClient.get 的内置重试用 isTransientError(不含超时),避免把满超时翻倍。 */
export async function retryTransient<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const transient = e instanceof ApiError && ([502, 503, 504].includes(e.status) || e.status === 0);
      if (transient && attempt < maxAttempts) {
        await sleep(Math.pow(2, attempt - 1) * 1000);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  timeoutMs?: number;
  text?: boolean; // 返回原始文本而非 JSON
  /** GET 瞬时错误(502/503/504/网络)重试次数,仅 get() 生效。
   *  默认 2(query/search/entity 等读命令幂等,安全可重试);
   *  hook 等自带绝对 deadline 的场景传 0,保证 R10 的 3s 上限不被重试撑破。 */
  retries?: number;
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
        throw new ApiError(0, `请求超时 (${timeout}ms): ${method} ${p}`, {}, null, true);
      }
      throw new ApiError(0, `网络错误: ${e?.message || String(e)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async get(p: string, query?: Record<string, QueryValue>, opts?: Omit<RequestOptions, 'query' | 'body'>): Promise<any> {
    const retries = opts?.retries ?? 2;
    let attempt = 0;
    for (;;) {
      try {
        return await this.request('GET', p, { ...opts, query });
      } catch (e) {
        // 读命令的瞬时错误统一在此重试(此前只有 ingest 链路有重试,query/search
        // 撞 502-504 直接失败)。退避短(0.5s/1s)且静默——不给每条命令加噪声。
        if (!isTransientError(e) || attempt >= retries) throw e;
        await sleep(500 * Math.pow(2, attempt));
        attempt++;
      }
    }
  }

  post(p: string, body?: unknown, opts?: Omit<RequestOptions, 'body' | 'query'>): Promise<any> {
    return this.request('POST', p, { ...opts, body });
  }

  del(p: string, opts?: Omit<RequestOptions, 'query' | 'body'>): Promise<any> {
    return this.request('DELETE', p, opts);
  }
}

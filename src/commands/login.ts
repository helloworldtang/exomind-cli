/** exomind login — 配置 base_url + 凭证,写入 ~/.exomind/config.json (0600)。
 *
 * 智能登录:已有凭据探活仍有效则直接返回,不弹浏览器(--force 跳过)。
 * 默认走设备码流程(免粘贴):POST /auth/device/code → 浏览器「授权登录」 → 轮询拿 key。
 * 服务端未上设备码端点(404)或 --api-key 指定时,退回手工粘贴流程。
 */
import { spawn } from 'node:child_process';
import * as os from 'node:os';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { ApiClient, ApiError } from '../api';
import { saveConfig, loadConfig, DEFAULT_BASE_URL } from '../config';
import { ok, dim, yellow, bold, cyan } from '../format';

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 尽力打开浏览器(失败静默——SSH/无桌面环境只打 URL)。 */
function openBrowser(url: string): void {
  try {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => undefined).unref();
  } catch {
    /* 打不开就算了,用户手点 URL */
  }
}

/** 设备码流程:发起 → 指路 → 轮询。拿到 key 返回;服务端不支持/超时抛错(调用方决定是否退回粘贴)。
 *
 * opts.openBrowser=false 供测试用——不真开系统浏览器(测试环境 spawn('open') 会真弹出)。 */
export async function deviceLogin(baseUrl: string, opts: { openBrowser?: boolean } = {}): Promise<string> {
  const boot = new ApiClient({ base_url: baseUrl, api_key: 'device-boot' }); // 白名单端点,不发真实凭证
  const info: Record<string, any> = await boot.post('/auth/device/code', {
    name: `emcli@${os.hostname().slice(0, 60)}`,
  });
  const userCode = String(info.user_code || '');
  const interval = Math.max(1, Number(info.interval) || 3);
  const expiresIn = Math.max(30, Number(info.expires_in) || 600);
  const url = String(info.verification_url || '/ui/device').startsWith('http')
    ? String(info.verification_url)
    : `${baseUrl.replace(/\/$/, '')}/ui/device?code=${encodeURIComponent(userCode)}`;

  console.log('');
  console.log(bold('设备登录'));
  console.log(`  1. 打开 ${cyan(url)}`);
  console.log(`  2. 确认设备码 ${bold(userCode)},点击「授权登录」`);
  console.log('');
  if (opts.openBrowser !== false) openBrowser(url);

  const deadline = Date.now() + expiresIn * 1000;
  while (Date.now() < deadline) {
    await sleep(interval * 1000);
    try {
      const r: Record<string, any> = await boot.post('/auth/device/token', {
        device_code: info.device_code,
      });
      if (r && r.api_key) return String(r.api_key);
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) {
        const detail = String(e.body?.error || e.detail || '');
        if (detail === 'authorization_pending') continue; // 正常等待
        throw new Error('设备登录会话已过期,请重新执行 emcli login');
      }
      throw e; // 网络/服务端错误直接抛
    }
  }
  throw new Error(`等待授权超时(${expiresIn}s),请重新执行 emcli login`);
}

/** 智能登录探活:已有凭据打一次受保护端点,200 即仍有效。
 * 401/403(失效)与网络错误都返回 false——交给设备流继续,它会给出更准确的错误。 */
export async function hasFreshCredential(baseUrl: string, apiKey: string): Promise<boolean> {
  const probe = new ApiClient({ base_url: baseUrl, api_key: apiKey });
  try {
    await probe.get('/keywords');
    return true;
  } catch {
    return false;
  }
}

export default async function login(
  _client: ApiClient,
  opts: { baseUrl?: string; apiKey?: string; force?: boolean },
): Promise<void> {
  const baseUrl = opts.baseUrl || DEFAULT_BASE_URL;
  let token = opts.apiKey || '';

  // 智能登录:无显式覆盖(--api-key/--base-url/--force)且已有凭据仍有效 → 直接返回,
  // 不弹浏览器。每次 login 都重走设备流会白白打断用户(与 wxpub login 同款语义)。
  if (!token && !opts.force && !opts.baseUrl) {
    const existing = loadConfig();
    const existingBase = existing.base_url || DEFAULT_BASE_URL;
    if (existing.api_key && (await hasFreshCredential(existingBase, existing.api_key))) {
      console.log(ok(`凭证仍有效(${existingBase}),未重新登录。强制重登用: emcli login --force`));
      return;
    }
  }

  if (!token) {
    // 默认设备码(浏览器「授权登录」,免粘贴);服务端未升级(404/405)退回手工粘贴
    try {
      token = await deviceLogin(baseUrl);
    } catch (e) {
      const unsupported = e instanceof ApiError && (e.status === 404 || e.status === 405);
      if (!unsupported) throw e;
      console.log(yellow('该服务器暂不支持设备登录,退回手工粘贴。'));
    }
  }
  if (!token) {
    console.log(dim('从 exomind-api.ai-as.cn/ui/account (登录后) 复制 API Key 或登录 token。'));
    token = await prompt('凭证: ');
  }
  if (!token) throw new Error('未提供凭证');

  // 先探活,通过后再落盘——避免无效凭证(401/403)覆盖已有有效配置
  // (auth_middleware 同时接受 API Key 与 gh_ token)
  const probe = new ApiClient({ base_url: baseUrl, api_key: token });
  let verified = true;
  try {
    await probe.get('/keywords'); // 受认证保护;401/403 说明凭证无效
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      throw new Error(`凭证校验失败 (HTTP ${e.status}): ${e.detail}`); // 不落盘
    }
    // 网络错误无法判定凭证有效性,不阻塞:先落盘,稍后用 exomind me 验证
    verified = false;
    console.log(
      yellow(
        `警告: 无法连接 ${baseUrl} 校验凭证 (${e instanceof Error ? e.message : String(e)})。配置仍将保存,稍后可用 exomind me 验证。`,
      ),
    );
  }

  saveConfig({ base_url: baseUrl, api_key: token });

  const hint = token.length > 12 ? `${token.slice(0, 8)}…${token.slice(-4)}` : token;
  console.log(ok(verified ? '登录成功' : '登录成功(未校验)'));
  console.log(dim(`  服务器: ${baseUrl}`));
  console.log(dim(`  凭证: ${hint} (${token.startsWith('gh_') ? 'GitHub token' : 'API Key'})`));
}

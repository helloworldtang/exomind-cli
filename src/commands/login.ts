/** exomind login — 配置 base_url + 凭证,写入 ~/.exomind/config.json (0600)。 */
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { ApiClient, ApiError } from '../api';
import { saveConfig, DEFAULT_BASE_URL } from '../config';
import { ok, dim, yellow } from '../format';

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export default async function login(
  _client: ApiClient,
  opts: { baseUrl?: string; apiKey?: string },
): Promise<void> {
  const baseUrl = opts.baseUrl || DEFAULT_BASE_URL;
  let token = opts.apiKey || '';

  if (!token) {
    console.log(dim('从 youhuale.cn/ui/account (登录后) 复制 API Key 或登录 token。'));
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
    // 网络错误无法判定凭证有效性,不阻塞:先落盘,稍后用 exomind whoami 验证
    verified = false;
    console.log(
      yellow(
        `警告: 无法连接 ${baseUrl} 校验凭证 (${e instanceof Error ? e.message : String(e)})。配置仍将保存,稍后可用 exomind whoami 验证。`,
      ),
    );
  }

  saveConfig({ base_url: baseUrl, api_key: token });

  const hint = token.length > 12 ? `${token.slice(0, 8)}…${token.slice(-4)}` : token;
  console.log(ok(verified ? '登录成功' : '登录成功(未校验)'));
  console.log(dim(`  服务器: ${baseUrl}`));
  console.log(dim(`  凭证: ${hint} (${token.startsWith('gh_') ? 'GitHub token' : 'API Key'})`));
}

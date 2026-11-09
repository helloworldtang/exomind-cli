/** exomind update — 替换 API Key: 用户已拿到新 key(管理端复制/服务端轮换后新签发),本地换上。
 *
 * 只管替换,不管新 key 怎么来——获取凭据走 login 的设备流。
 * --api-key 直传,缺省交互粘贴;校验通过才落盘,避免无效 key 覆盖现有有效配置。
 */
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { ApiClient, ApiError } from '../api';
import { loadConfig, saveConfig } from '../config';
import { ok, dim, yellow } from '../format';

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export default async function update(
  _client: ApiClient,
  opts: { apiKey?: string },
): Promise<void> {
  const { base_url: baseUrl } = loadConfig();
  let token = opts.apiKey || '';
  if (!token) {
    console.log(dim('粘贴新 API Key(从 exomind 管理端 account 页复制);要重新走设备流获取用 exomind login --force。'));
    token = await prompt('新凭证: ');
  }
  if (!token) throw new Error('未提供凭证');

  // 校验通过再落盘,避免无效凭证覆盖已有有效配置(与 login 同款探活)
  const probe = new ApiClient({ base_url: baseUrl, api_key: token });
  try {
    await probe.get('/keywords');
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      throw new Error(`凭证校验失败 (HTTP ${e.status}): ${e.detail}`); // 不落盘
    }
    console.log(yellow(`警告: 无法连接 ${baseUrl} 校验凭证,配置仍将保存,稍后可用 exomind me 验证。`));
  }

  saveConfig({ base_url: baseUrl, api_key: token });
  const hint = token.length > 12 ? `${token.slice(0, 8)}…${token.slice(-4)}` : token;
  console.log(ok('凭证已替换'));
  console.log(dim(`  服务器: ${baseUrl}`));
  console.log(dim(`  凭证: ${hint} (${token.startsWith('gh_') ? 'GitHub token' : 'API Key'})`));
}

/** exomind whoami — 显示当前登录态。 */
import type { ApiClient } from '../api';
import { loadConfig } from '../config';
import { output, ok, dim, yellow } from '../format';

export default async function whoami(client: ApiClient): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.api_key) {
    console.log(yellow('未登录。运行 exomind login。'));
    return;
  }

  let me: Record<string, unknown> = {};
  try {
    me = await client.get('/auth/me');
  } catch {
    me = {};
  }

  const hint = cfg.api_key.length > 12 ? `${cfg.api_key.slice(0, 8)}…${cfg.api_key.slice(-4)}` : cfg.api_key;
  const kind = cfg.api_key.startsWith('gh_') ? 'GitHub token' : 'API Key';

  output(
    { base_url: cfg.base_url, credential: hint, kind, ...(me as object) },
    () => {
      console.log(ok('已登录'));
      console.log(dim(`  服务器: ${cfg.base_url}`));
      console.log(dim(`  凭证: ${hint} (${kind})`));
      if (me.authenticated) {
        // tenant_id 即 user_id（ExoMind 用 auth 的 user_id 做租户隔离键）
        const userId = me.tenant_id || '-';
        const display = me.name || me.login || '';
        if (display) {
          console.log(dim(`  用户: ${display} (用户ID: ${userId})`));
        } else if (me.method === 'api_key') {
          console.log(dim(`  用户ID: ${userId}（API Key 不携带用户名）`));
        } else {
          console.log(dim(`  用户ID: ${userId}`));
        }
        // 凭据有效期:manager /auth/me 透传(auth 北京时间串);null=长期有效,
        // undefined(JWT/旧服务端)=不显示——有则显示、无则静默,不欠表现。
        if (me.method === 'api_key' && 'expires_at' in me) {
          const exp = me.expires_at;
          console.log(dim(`  凭证有效期: ${typeof exp === 'string' && exp ? exp : '长期有效'}`));
        }
      }
    },
  );
}

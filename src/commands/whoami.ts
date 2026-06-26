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
        console.log(dim(`  用户: ${me.name || me.login || '-'} (tenant: ${me.tenant_id || '-'})`));
      }
    },
  );
}

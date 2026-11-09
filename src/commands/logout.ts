/** exomind logout — 清除本地凭据(保留 base_url,下次 login 不用重填服务器)。
 *
 * 只清本地:服务端没有客户端自助吊销端点,key 的注销要在 exomind 管理端操作。
 * ~/.exomind/config.json 由 exomind-cli / earshot / fireCut 共享,清 key 后三者
 * 的调用一起失效——必须提示,不能静默。
 */
import * as fs from 'node:fs';
import { loadConfig, saveConfig, LEGACY_KEY_FILE } from '../config';
import { ok, dim, yellow } from '../format';

export default async function logout(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.api_key) {
    console.log(yellow('未登录(本地无凭据),无需登出。'));
    return;
  }

  saveConfig({ base_url: cfg.base_url, api_key: '' });
  // 旧 install 把 key 写在 legacy 文件,loadConfig 会兜底读它——不清等于没登出
  try {
    fs.unlinkSync(LEGACY_KEY_FILE);
  } catch {
    /* 文件不存在即无事 */
  }

  console.log(ok('已登出,本地凭据已清除'));
  console.log(dim(`  服务器配置保留: ${cfg.base_url},重新登录: exomind login`));
  if (process.env.EXOMIND_API_KEY) {
    console.log(yellow('  注意: 环境变量 EXOMIND_API_KEY 仍设置着,会继续盖过配置文件。'));
  }
  console.log(
    yellow('  注意: ~/.exomind/config.json 由 exomind-cli/earshot/fireCut 共享,它们的调用也会失效。'),
  );
  console.log(dim('  服务端吊销该 key 请到 exomind 管理端(account 页)操作。'));
}

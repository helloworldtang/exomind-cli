/** 项目身份锚(R31 handoff 三级匹配键的 CLI 侧实现)。
 *
 *  三级解析(需求明文禁止裸 cwd 字符串匹配——clone 搬迁/git worktree 会断链):
 *  ① git remote URL(归一化到 host/owner/repo)——同一仓库的任何 checkout/worktree
 *     解析出同一 key,接力不断;
 *  ② 非 git 目录 → 目录绝对路径兜底;
 *  ③ 跨项目切换不在此函数职责内(显式反查 emcli handoff <项目名>,服务端做)。
 *
 *  注意:必须以「事件里的 cwd」为基准,不能用 process.cwd()——OpenClaw 网关桥接时
 *  CLI 进程的 cwd 是 gateway 的,不是用户项目目录。 */
import * as fs from 'node:fs';
import * as path from 'node:path';

/** 归一化 git URL:ssh 形式(git@host:owner/repo.git)与 https 形式归一为 host/owner/repo。
 *  大小写不敏感(host 部分),路径保留大小写(git 区分)。 */
export function normalizeGitUrl(u: string): string {
  let s = u.trim().replace(/\.git$/, '');
  s = s.replace(/^[a-zA-Z0-9_.-]+@/, ''); // git@host: → host:
  s = s.replace(/^https?:\/\//i, ''); // https://host/...
  s = s.replace(/^ssh:\/\//i, '');
  s = s.replace(/:(?=\S)/, '/'); // host:owner/repo → host/owner/repo(仅首个冒号)
  s = s.replace(/\/+/g, '/');
  return s.toLowerCase() === s ? s : s;
}

/** 读指定目录的 .git/config 内容;worktree(.git 是文件)追一层到主仓 config。 */
function readGitConfig(cwd: string): string | null {
  const dotGit = path.join(cwd, '.git');
  let cfgPath = path.join(dotGit, 'config');
  try {
    const st = fs.statSync(dotGit);
    if (st.isFile()) {
      // worktree/submodule:.git 是文件,内容 "gitdir: <path>" → 主仓 config 在其上两级
      const content = fs.readFileSync(dotGit, 'utf-8').trim();
      const m = content.match(/^gitdir:\s*(\S+)/);
      if (!m?.[1]) return null;
      const gitdir = path.resolve(m[1]);
      // 优先 worktree 自己的 config(含部分配置),缺 remote 时上层调用落兜底
      cfgPath = path.join(gitdir, 'config');
      if (!fs.existsSync(cfgPath)) cfgPath = path.join(path.dirname(path.dirname(gitdir)), 'config');
    }
    return fs.readFileSync(cfgPath, 'utf-8');
  } catch {
    return null;
  }
}

/** 三级匹配键入口:git remote URL > 目录绝对路径。与 detectProjectTag(hook.ts,取
 *  仓库名做展示标签)职责不同——这里要的是完整身份键,用于服务端 handoff 匹配。 */
export function resolveProjectKey(cwd: string): string {
  const cfg = readGitConfig(cwd);
  if (cfg) {
    // 取首个 remote 的 URL(多 remote 取 origin 优先)
    let url: string | undefined;
    let inOrigin = false;
    for (const line of cfg.split('\n')) {
      const sec = line.match(/^\s*\[remote\s+"([^"]+)"\]/);
      if (sec) {
        inOrigin = sec[1] === 'origin';
        if (inOrigin) url = undefined; // origin 段开始,重置
        continue;
      }
      const m = line.match(/^\s*url\s*=\s*(\S+)/);
      if (m?.[1] && (inOrigin || !url)) url = m[1];
    }
    if (url) return normalizeGitUrl(url);
  }
  return path.resolve(cwd);
}

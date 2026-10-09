# exomind — 所有 Agent 的共享外脑

> ExoMind 知识飞轮的 Agent 接入面:一条命令,把你的外脑挂进任何 MCP 宿主——Claude Code / Codex / OpenCode / OpenClaw / Cursor。

ExoMind 不做 Agent,做 Agent 的插件:你的知识、经验、踩坑记录沉淀在知识飞轮里,任何 Agent 通过 CLI(本包)、MCP 工具、hook 注入三种方式读写同一份外脑——**Agent 换了一茬又一茬,外脑永远是你的**。

```bash
npm install -g exomind
emcli login               # 设备码登录:浏览器「授权登录」,免粘贴(自动打开 youhuale.cn/ui/device)
emcli install             # skill + hook + MCP,四宿主一次装齐(幂等,可重复执行)
```

装完后,宿主里的 Agent 自动获得:相关知识的**上下文注入**(每条 prompt 前)、12 个 **MCP typed tools**(查询/搜索/摄入/复习/综合/缺口分析)、以及"存档"暗号触发的**经验自动摄入**。

- **跨宿主**:MCP 是标准协议,同一份 stdio server 全宿主通用;skill/hook 由 `emcli install` 按宿主自动配置。
- **跨平台**:纯 Node,Windows PowerShell / macOS / Linux 行为完全一致,无需 Git Bash / Python / curl。
- **零运行时依赖**:`commander` / `picocolors` 由 tsup 打进单文件,基于 Node 18+ 全局 `fetch`。
- **服务器零改动**:命令与服务端 REST 端点 1:1,认证走 `Authorization: Bearer`。
- **自带飞轮**:`emcli hook` 子命令跨平台复刻旧 bash hook(存档暗号 / 经验·调研自动摄入 / 关键词上下文注入)。

> **命令名**:npm 包名是 `exomind`,装出的 CLI 有两个等价命令名(bin 双名同入口):本 README 示例统一用 `emcli`,敲 `exomind` 完全等价。

> 前置:Node.js 18+(`node -v`)。CI 等场景可改用环境变量 `EXOMIND_API_KEY` / `EXOMIND_BASE_URL`,免登录。

## 快速开始

```bash
# 导入知识(参数 / stdin / 文件)
emcli ingest "Redis 持久化:RDB 快照 + AOF 日志,混合模式推荐" -t "Redis 持久化" --tag redis
echo "管道内容" | emcli ingest -t "标题"
emcli ingest --file ./notes.md -t "标题"
emcli ingest --dir ./notes --recursive      # 目录批量(增量: SHA-256 跳过未变文件)

# 查询与搜索
emcli query "Redis RDB 和 AOF 的区别?"
emcli search "Redis 持久化" --rerank
emcli entity "Redis"          # 实体详情 + 关系
emcli stats                   # 知识飞轮统计

# 飞轮
emcli review                  # FSRS-5 间隔复习
emcli gaps                    # 知识缺口(驱动摄入)
emcli feedback "entities/Redis.md" positive
```

加 `--json` 获取机器可读输出(脚本/管道):`emcli --json stats | jq .total_nodes`。

## 凭证管理

`emcli login` 默认走**设备码登录**:终端显示 8 位设备码并打开浏览器,你在网页上点「授权登录」后,CLI 自动拿到专属 API Key(10 分钟内有效,无需复制粘贴)。服务端未升级时自动退回手工粘贴;脚本化场景用 `emcli login --api-key <key>`。凭证持久化到本地,后续命令自动读取,无需重复登录。

- **存储位置**:`~/.exomind/config.json`(明文 JSON),文件权限 `0600`(仅所有者可读写;Windows 无 POSIX 权限则忽略)。
- **凭证类型**:服务端 `auth_middleware` 同时接受 **API Key**(从 `youhuale.cn/ui/account` 复制)与 **GitHub token**(`gh_` 前缀);两者统一以 `Authorization: Bearer` 发送,CLI 不关心是哪种。
- **读取优先级**:`config.json` 的 `api_key` → 环境变量 `EXOMIND_API_KEY` → 旧版遗留文件 `~/.claude/scripts/.exomind-api-key`(向后兼容老安装)。三者任一存在即免登录。
- **CI / 免登录**:只设环境变量 `EXOMIND_API_KEY`(可选 `EXOMIND_BASE_URL`)即可,完全不写本地文件。`config.json` 优先级高于环境变量,故已 `login` 的机器需 `--api-key` 才能临时覆盖。
- **校验行为**:`login` 先探活 `/keywords` **通过后再落盘**——401/403 时**不写文件**,避免无效凭证覆盖已有有效配置;网络错误无法判定时仍保存并提示"登录成功(未校验)",稍后用 `emcli me` 复核。
- **换号 / 登出**:重新 `emcli login` 覆盖旧凭证;彻底登出删 `~/.exomind/config.json`。
- **安全提醒**:文件是**明文**,任何能读你 home 目录的进程都能拿到 key。共享机器 / 不信任环境请用环境变量,不要用 `login`。

> 把 API Key 当密码对待:不提交进仓库、不贴进聊天。脚本化登录用 `emcli login --api-key ...`(注意别让 key 进 shell 历史或进程列表);交互式 `emcli login` 的 prompt 读取不走 shell 历史。

## 接入 Claude Code / Codex / OpenClaw(一条命令,默认全装)

```bash
emcli install          # 装 skill + hook + MCP(各宿主),全部自动(幂等+备份)
# 只装某个宿主: emcli install --host codex   (claude | codex | opencode | openclaw)
# OpenClaw 缺省按 ~/.openclaw 存在自动检测:skill + before_prompt_build 桥接插件 + MCP
# 跳过某项: --no-skill / --no-hook / --no-mcp
```

**Codex**(skill + MCP,无 hook):装到 `$CODEX_HOME/skills/exomind/`(缺省 `~/.codex/`),MCP 写入 `$CODEX_HOME/config.toml`。**Codex 没有 Claude 的 UserPromptSubmit hook**,靠 skill 的触发词(jdit/存档/查询)驱动;MCP `ingest` 只收文本,目录导入走 `emcli ingest --dir`。装完**重启 Codex**,skill 列表应出现 `exomind`。

排查各宿主装没装上:`emcli doctor`(或 `emcli --json doctor`)。

一行完成三层,免手改任何 JSON:
- **① MCP 工具**(能力):写 `~/.claude.json` 的 `mcpServers.exomind` → Agent 拿到 `mcp__exomind__*` 确定性工具。
- **② skill**(指导):拷到 `~/.claude/skills/exomind/`。
- **③ hook**(闸门):写 `settings.json` 的 `UserPromptSubmit → emcli hook`。

重启 Claude Code 后:
- 说 **`存档`** / **`jdit`** → 自动回顾会话、摄入。
- 提问涉及知识飞轮已有实体 → 自动注入 `[ExoMind 知识飞轮上下文]`。
- Agent 需查询/摄入时 → 直接调 `mcp__exomind__*`(确定),或按 skill 跑 `exomind` CLI。

完整接入步骤见服务端仓库 `myExoMindManager/docs/new-machine-setup.md`。

**升级**:`npm i -g exomind@latest && emcli install`(幂等,刷新 skill/hook/mcp;`~/.exomind/` 的 config 与 manifest 保留)。注意:`npm i -g` 只换二进制(CLI+MCP 自动用新),**skill 是拷贝的,需 `emcli install` 才刷新**。

## 关于 MCP 工具层(Claude Code / OpenCode / Codex 都已默认装)

`emcli install` 一次写**各宿主**的 MCP 配置(Claude/OpenCode/Codex 手写配置文件,OpenClaw 走官方 `openclaw mcp add` 自带 probe;都幂等+备份,互不干扰,各读各的):
- **Claude Code**:`~/.claude.json` → `mcpServers.exomind`
- **OpenCode**:`~/.config/opencode/opencode.json` → `mcp.exomind`
- **Codex**:`$CODEX_HOME/config.toml` → `[mcp_servers.exomind]`

只关 MCP:`emcli install --no-mcp`(三个宿主都不写)。手写/其它宿主(如 Cursor)参考 [docs/mcp.md](./docs/mcp.md)。

`emcli mcp` 是本地 stdio MCP server,把 12 个核心命令(ingest/query/search/entity/relations/stats/review/review_mark/synthesize/topics/daily/gaps)暴露为 typed tool;复用同一份凭证,三平台都能跑(本地 stdio,不涉及远程 SSE 的 Windows 坑)。

## 命令一览

| 命令 | 说明 |
|------|------|
| `login` / `me` | 配置与查看登录态 |
| `ingest` / `archive` | 导入/存档知识(文本 / stdin / `--file`;`--origin <tag>` 来源打标——hook 自动摄入服务端记 `hook-auto`,与用户显式存档区分,R24 候选区判据) |
| `backfill` / `drain` | 补跑降级摄入(原文已入库、实体抽取待补)/ 补投本地队列(断网时未提交的摄入) |
| `query` | LLM 问答 |
| `search` | 全文 / `--hybrid` / `--rerank` 搜索 |
| `entity` / `relations` | 实体详情、关联实体 |
| `stats` | 知识飞轮统计 |
| `review` / `review mark` | FSRS-5 复习队列与评分 |
| `synthesize` / `topics` / `gaps` / `daily` | 主题综合、选题、缺口、每日摘要 |
| `feedback` | 质量反馈(影响搜索排名) |
| `install` | 装 skill(Claude+Codex+OpenClaw)+ hook(Claude/OpenClaw)+ MCP(四宿主);`--host`/`--no-skill`/`--no-hook`/`--no-mcp` |
| `doctor` | 诊断各宿主(claude/codex/opencode/openclaw)skill/hook/MCP/鉴权 状态(`--json`) |
| `hook` / `hook-session-end` | prompt 注入钩子 / SessionEnd 采集探针(均由 install 配置,后者为 P3 会话编译积累数据,纯本地) |

完整命令参考与排错见 **[CLI 命令指南](./docs/cli-guide.md)**。

## 工作原理

```
Claude Code skill「exomind」(教 Agent 用 CLI)
        │
  UserPromptSubmit hook → emcli hook (跨平台,无 bash/python)
   - 存档/jdit 暗号、经验/调研自动检测 → 提示 emcli ingest
   - /keywords + /entities 本地缓存 → 上下文注入(弱服务器友好)
        │
  emcli CLI  ──HTTPS REST (Bearer)──▶  ExoMind 服务器
      /ingest /query /search /entities …
```

数据只在服务器一份;CLI / skill / hook 都是纯客户端,无需同步本地 wiki。

## 开发者

```bash
cd cli
npm install          # devDependencies
npm run build        # tsup → dist/cli.js
npm test             # node:test 单元测试(默认 23 个,e2e 默认 skip)
node dist/cli.js --help
```

- **单元测试**:`npm test`,覆盖 hook 触发正则、config 往返+兼容、api 错误归一、format 双模。
- **协议级 e2e**:`test/e2e.test.ts`,默认 skip;`EXOMIND_API_KEY=sk_xxx npm test` 时打真实服务器(只读 stats/search/entity)。与服务器**只通过协议耦合**,不引用服务端仓库文件。

### 项目结构

```
src/
  cli.ts        commander 入口 + 全局选项 + 错误处理
  config.ts     ~/.exomind/config.json + 向后兼容旧 key
  api.ts        fetch 封装(Bearer / 超时 / 错误归一)
  format.ts     人类可读 + --json 双模
  io.ts         stdin / 文件读取
  hook.ts       UserPromptSubmit 钩子(替代 bash hook)
  commands/     每个命令一个文件
skill/claude/SKILL.md  Claude Code skill 源(install 时拷贝)
skill/codex/SKILL.md   Codex skill 源(install 时拷到 $CODEX_HOME/skills/exomind/)
test/           node:test 单元 + 协议级 e2e
```

### 发布到 npm(自动,tag 触发)

推 `v*` tag → GitHub Action 自动构建并发布(见 `.github/workflows/release.yml`),用仓库 secret `NPM_TOKEN` 认证。

```bash
npm version patch          # bump 版本 + 建 commit + 建 v* tag
git push --follow-tags     # 推 tag → 触发 CI → npm publish(带 provenance)
```

> **首次配置**:在 npm 建 **Granular Access Token**(bypass 2FA,仅 `exomind` 包写权限),加到仓库 secret `NPM_TOKEN`。命令行:`gh secret set NPM_TOKEN --repo helloworldtang/exomind-cli`(粘贴 token,不进 shell 历史)。
> 发布内容由 `package.json` 的 `files: ["dist", "skill"]` 控制——只发构建产物与 skill,不含 src/test。
>
> 完整流程（验证 / 排错 / 发布历史）：见 **[docs/release.md](./docs/release.md)**。

## 设计要点

- **CJS 输出**:tsup `format: cjs`,规避 ESM 打包 CJS 依赖时的 `Dynamic require of "events"`;bin 顶部带 shebang。
- **凭证类型无关**:`emcli login` 存入的字符串以 `Bearer` 发送,服务器 `auth_middleware` 同时接受 API Key 与 GitHub token(`gh_`)。
- **hook 弱服务器友好**:`/keywords` 本地缓存 1h,实体描述按 miss 拉取并缓存,per-prompt 命中缓存即零服务器命中。

## License

MIT

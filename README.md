# exomind

> ExoMind 知识库的跨平台命令行客户端。通过 REST 与服务器交互,装一次,Windows / macOS / Linux 一致可用。

替代在 Windows 上连不上的 MCP 客户端;Mac/Linux 同样适用。对标 PipeOne 的 `@pipeone/cli` + skill 模式。

- **跨平台**:纯 Node,Windows PowerShell / macOS / Linux 行为完全一致,无需 Git Bash / Python / curl。
- **零运行时依赖**:`commander` / `picocolors` 由 tsup 打进单文件,基于 Node 18+ 全局 `fetch`。
- **服务器零改动**:命令与服务端 REST 端点 1:1,认证走 `Authorization: Bearer`。
- **自带飞轮**:`exomind hook` 子命令跨平台复刻旧 bash hook(存档暗号 / 经验·调研自动摄入 / 关键词上下文注入)。

## 安装

```bash
npm install -g exomind
exomind login               # 粘贴 d.youhuale.cn/ui/account 的 API Key
exomind whoami              # 验证登录
```

> 前置:Node.js 18+(`node -v`)。CI 等场景可改用环境变量 `EXOMIND_API_KEY` / `EXOMIND_BASE_URL`,免登录。

## 快速开始

```bash
# 导入知识(参数 / stdin / 文件)
exomind ingest "Redis 持久化:RDB 快照 + AOF 日志,混合模式推荐" -t "Redis 持久化" --tag redis
echo "管道内容" | exomind ingest -t "标题"
exomind ingest --file ./notes.md -t "标题"
exomind ingest --dir ./notes --recursive      # 目录批量(增量: SHA-256 跳过未变文件)

# 查询与搜索
exomind query "Redis RDB 和 AOF 的区别?"
exomind search "Redis 持久化" --rerank
exomind entity "Redis"          # 实体详情 + 关系
exomind stats                   # 知识库统计

# 飞轮
exomind review                  # FSRS-5 间隔复习
exomind gaps                    # 知识缺口(驱动摄入)
exomind feedback "entities/Redis.md" positive
```

加 `--json` 获取机器可读输出(脚本/管道):`exomind --json stats | jq .total_nodes`。

## 接入 Claude Code(一条命令,默认全装)

```bash
exomind install          # 装 skill + hook + MCP,全部自动(幂等+备份)
# 不想要某项: exomind install --no-hook  或  --no-mcp
```

一行完成三层,免手改任何 JSON:
- **① MCP 工具**(能力):写 `~/.claude.json` 的 `mcpServers.exomind` → Agent 拿到 `mcp__exomind__*` 确定性工具。
- **② skill**(指导):拷到 `~/.claude/skills/exomind/`。
- **③ hook**(闸门):写 `settings.json` 的 `UserPromptSubmit → exomind hook`。

重启 Claude Code 后:
- 说 **`存档`** / **`jdit`** → 自动回顾会话、摄入。
- 提问涉及知识库已有实体 → 自动注入 `[ExoMind 知识库上下文]`。
- Agent 需查询/摄入时 → 直接调 `mcp__exomind__*`(确定),或按 skill 跑 `exomind` CLI。

完整接入步骤见服务端仓库 `myExoMindManager/docs/new-machine-setup.md`。

**升级**:`npm i -g exomind@latest && exomind install`(幂等,刷新 skill/hook/mcp;`~/.exomind/` 的 config 与 manifest 保留)。注意:`npm i -g` 只换二进制(CLI+MCP 自动用新),**skill 是拷贝的,需 `exomind install` 才刷新**。

## 关于 MCP 工具层(Claude Code + OpenCode 都已默认装)

`exomind install` 一次写**两个宿主**的 MCP 配置(都幂等+备份,互不干扰,各读各的):
- **Claude Code**:`~/.claude.json` → `mcpServers.exomind`
- **OpenCode**:`~/.config/opencode/opencode.json` → `mcp.exomind`

只关 MCP:`exomind install --no-mcp`(两个宿主都不写)。手写/其它宿主(如 Cursor)参考 [docs/mcp.md](./docs/mcp.md)。

`exomind mcp` 是本地 stdio MCP server,把 ingest/query/search/entity/relations/stats 暴露为 typed tool;复用同一份凭证,三平台都能跑(本地 stdio,不涉及远程 SSE 的 Windows 坑)。

## 命令一览

| 命令 | 说明 |
|------|------|
| `login` / `whoami` | 配置与查看登录态 |
| `ingest` | 导入知识(文本 / stdin / `--file`) |
| `query` | LLM 问答 |
| `search` | 全文 / `--hybrid` / `--rerank` 搜索 |
| `entity` / `relations` | 实体详情、关联实体 |
| `stats` | 知识库统计 |
| `review` / `review mark` | FSRS-5 复习队列与评分 |
| `synthesize` / `topics` / `gaps` / `daily` | 主题综合、选题、缺口、每日摘要 |
| `feedback` | 质量反馈(影响搜索排名) |
| `hook` / `install` | UserPromptSubmit 钩子、安装 skill+hook |

完整命令参考与排错见 **[CLI 命令指南](./docs/cli-guide.md)**。

## 工作原理

```
Claude Code skill「exomind」(教 Agent 用 CLI)
        │
  UserPromptSubmit hook → exomind hook (跨平台,无 bash/python)
   - 存档/jdit 暗号、经验/调研自动检测 → 提示 exomind ingest
   - /keywords + /entities 本地缓存 → 上下文注入(弱服务器友好)
        │
  exomind CLI  ──HTTPS REST (Bearer)──▶  ExoMind 服务器
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
skill/SKILL.md  Claude Code skill 源(install 时拷贝)
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

## 设计要点

- **CJS 输出**:tsup `format: cjs`,规避 ESM 打包 CJS 依赖时的 `Dynamic require of "events"`;bin 顶部带 shebang。
- **凭证类型无关**:`exomind login` 存入的字符串以 `Bearer` 发送,服务器 `auth_middleware` 同时接受 API Key 与 GitHub token(`gh_`)。
- **hook 弱服务器友好**:`/keywords` 本地缓存 1h,实体描述按 miss 拉取并缓存,per-prompt 命中缓存即零服务器命中。

## License

MIT

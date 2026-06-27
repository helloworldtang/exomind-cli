# ExoMind CLI 命令指南

`exomind` 是 ExoMind 知识库的跨平台命令行客户端,通过 REST 与服务器交互。
替代 Windows 上不可用的 MCP 客户端;Mac/Linux 同样适用。

- 包名:`exomind`(npm)
- 运行时:Node.js 18+
- 配置:`~/.exomind/config.json`(权限 0600)
- 全局选项:`--json`(机器可读)、`--base-url <url>`、`--api-key <key>`、`-V/--version`、`-h/--help`

## 安装

```bash
npm install -g exomind
exomind login            # 粘贴 d.youhuale.cn/ui/account 的 API Key
exomind install --with-hook   # 装 Claude Code skill + UserPromptSubmit hook
```

三平台一致。Windows 无需 Git Bash。完整接入步骤见服务端仓库的 `docs/new-machine-setup.md`。

## 命令参考

### 登录与配置

| 命令 | 说明 |
|------|------|
| `exomind login [--base-url <url>] [--api-key <key>]` | 配置服务器地址与凭证;不传 `--api-key` 则交互输入 |
| `exomind whoami` | 显示当前登录态与服务器 |

凭证也支持环境变量 `EXOMIND_API_KEY` / `EXOMIND_BASE_URL`(便于 CI)。
向后兼容:若未配置,会回落读取旧 install 的 `~/.claude/scripts/.exomind-api-key`。

### 导入知识(写)

```bash
exomind ingest "内容文本" -t "描述性标题" --tag cli --tag exomind
echo "管道内容" | exomind ingest -t "标题"
exomind ingest --file ./notes.md -t "标题"
```

| 选项 | 说明 |
|------|------|
| `-t, --title <title>` | 标题 |
| `--tag <tag>` | 标签(可重复) |
| `--file <path>` | 从文件读取内容 |

### 查询与搜索(读)

```bash
exomind query "如何做 X?"             # LLM 问答,引用 KB 页面
exomind search "关键词"               # 全文搜索
exomind search "关键词" --hybrid --rerank  # 混合 + LLM 精排(更准更慢)
exomind search "关键词" -l 20         # 限制返回数
```

| 命令 / 选项 | 说明 |
|------|------|
| `query [question...]` `--tag` `--model` | LLM 问答 |
| `search [keyword...]` `-l,--limit` `--rerank` `--hybrid` | 全文/混合/精排 |
| `entity [name...]` | 实体详情 + 关系 |
| `relations [name...]` `-d,--depth 1-3` | 关联实体(可达性) |
| `stats` | 知识库统计(节点/关系/类型分布) |

### 复习与反馈(飞轮)

```bash
exomind review                       # 待复习列表(FSRS-5)
exomind review mark "Redis" -r 3     # 标记复习(1=忘记 2=吃力 3=顺利 4=轻松)
exomind feedback "entities/Redis.md" positive   # 质量反馈
```

### 洞察

```bash
exomind synthesize "主题" --depth 2   # 主题综合报告
exomind topics                       # 选题推荐
exomind gaps                         # 知识缺口(驱动摄入)
exomind daily                        # 每日活动摘要
```

### 自动化(hook / install)

| 命令 | 说明 |
|------|------|
| `exomind hook` | UserPromptSubmit 钩子,由 Claude Code 自动调用(非手动)。读 stdin `{prompt}`,输出 additionalContext |
| `exomind install [--with-hook]` | 安装 skill 到 `~/.claude/skills/exomind/`;`--with-hook` 同时写入 settings.json 的 hook |

`exomind hook` 复刻旧 `exomind-context.sh` 的全部行为:存档/jdit 暗号、经验/调研自动摄入、关键词上下文注入(本地缓存,弱服务器友好)、会话去重。零 bash/python/curl/本地 wiki 依赖。

## 输出模式

- 默认:人类可读(上色,非 TTY 自动不上色)。
- `--json`:原始 JSON,适合脚本/管道。例:`exomind --json stats | jq .total_nodes`。

## 与服务器的对应关系

CLI 命令与服务端 REST 端点 1:1(见 `src/exo/api/query.py`):`ingest`→`POST /ingest`、`query`→`POST /query`、`search`→`GET /search`、`entity`→`GET /entities/{name}`……认证统一走 `Authorization: Bearer <key>`,与 MCP 共用同一套 `auth_middleware`。**服务器端零改动**。

## 故障排查

| 现象 | 处理 |
|------|------|
| `未登录。请先运行 exomind login` | 登录,或设 `EXOMIND_API_KEY` |
| `HTTP 401: ...` | API Key 错误或失效,重新登录获取 |
| `请求超时` | query/synthesize 走 LLM 较慢;或网络问题,重试 |
| `exomind: command not found` | 确认 npm 全局 bin 在 PATH;或用 `npx exomind ...` |
| hook 不注入上下文 | 先登录;首次会拉 `/keywords` 建缓存(1h TTL),稍候 |
| 颜色/乱码 | 非 TTY 自动关闭颜色;强制关设 `NO_COLOR=1` |

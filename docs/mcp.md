# exomind mcp —— MCP 工具层(确定性 + 跨宿主)

`exomind mcp` 是一个**本地 stdio MCP server**,把 ExoMind 的核心命令暴露为 **typed tool**。

## 为什么要有它(三层模式)

ExoMind 的能力由三层组成,各司其职:

| 层 | 实现 | 性质 |
|---|---|---|
| **① MCP 工具**(能力) | `exomind mcp` | **确定**:Agent 调 typed tool,参数/返回结构化 |
| **② Skill**(指导) | `~/.claude/skills/exomind/SKILL.md` | 非确定:教 Agent 何时用、铁律 |
| **③ Hook**(闸门) | `exomind hook`(UserPromptSubmit) | **确定**:每条 prompt 强制注入+触发 |

只靠 ②(skill 指导 → 拼 bash)是最弱的——skill 发现是非确定的、模型也可能不守铁律。补上 ①(MCP typed tool)后,Agent 用**确定的 tool call** 调能力,不再"读 markdown 自己造命令"。

而且 **MCP 是跨宿主标准**:Claude Code / OpenCode / Cursor 都认;skill 自动发现是 Claude Code 独有。接入 MCP = 同一份配置多宿主通用。

## 接入配置

先 `exomind login`(MCP server 复用 `~/.exomind/config.json` 凭证)。

**Claude Code**(`~/.claude.json` 或项目 `.mcp.json`):
```json
{ "mcpServers": { "exomind": { "command": "exomind", "args": ["mcp"] } } }
```

**OpenCode**(`opencode.json`):
```json
{ "mcp": { "exomind": { "type": "local", "command": ["exomind", "mcp"] } } }
```

**Cursor / 其它**:同样以 `exomind mcp` 作为 stdio 命令接入。

> 本地 stdio,所以**不涉及**当年远程 SSE 在 Windows 的传输版本坑——Node stdio 三平台一致。

## 暴露的工具

| 工具 | 参数 | 对应 |
|---|---|---|
| `ingest` | content, title?, tags? | POST /ingest |
| `query` | question, tags? | POST /query |
| `search` | keyword, limit? | GET /search |
| `entity` | name | GET /entities/{name} |
| `relations` | name, depth? | GET /relations/{name} |
| `stats` | — | GET /stats |

工具执行错误返回 `isError: true`(按 MCP 规范),不会污染协议层。

## 与 skill / hook 的关系

三者**并存不冲突**:
- MCP 工具:Agent 要"做"某事时,直接调(最稳)。
- skill:Agent 不确定"该不该做/怎么做"时,读指导。
- hook:无论 Agent 做不做,每条 prompt 都强制注入上下文 + 检测摄入触发(飞轮兜底)。

可以**只用其中一部分**:只要 CLI + skill(最简);要确定性加 MCP;要飞轮自动化加 hook。

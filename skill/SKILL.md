---
name: exomind
description: Interact with the ExoMind knowledge base — ingest insights/experiences/research/decisions, query, full-text search, FSRS review, and explore entities/relations. Use when the user wants to save knowledge into, or retrieve knowledge from, their ExoMind KB. Also use proactively to persist valuable session outcomes (lessons, decisions, root causes) via `exomind ingest`.
---

# ExoMind CLI

`exomind` is a cross-platform CLI that talks to your ExoMind knowledge base over REST. It replaces the MCP client (which is unreliable on Windows). After a one-time `exomind login` (paste the API Key from `d.youhuale.cn/ui/account`), every command works identically on Windows / macOS / Linux.

If a command fails with "未登录", run `exomind login` first.

## ⚠️ 用法铁律(最先读,必守)

1. **目录 / 多个文件 → 一条 `exomind ingest --dir <路径>`**(增量,自动跳过已摄文件)。**绝不**逐文件调用 Skill 工具、**绝不**逐条 `exomind ingest --file`。**用 `--dir` 时不要先 `Read` 文件**——CLI 自己读,预读纯浪费上下文。
2. **Skill 工具只调用一次**(加载本文件一次即可,后续一律用 Bash 跑 `exomind ...`)。
3. 单条知识 → `exomind ingest "内容" -t 标题 --tag 标签`。
4. ingest 是**同步**(每文件 1-3 min);`--dir` 串行 + `⏳[i/n]` 进度 + 结束汇总(新增/更新/跳过/失败),不是后台异步。
5. **"全部跳过"= 成功**(文件已在库且内容未变),**绝不**因此擅自加 `--force` 重摄(会白白重跑 N×分钟 LLM)。只有用户**明确**说"强制刷新/全量重处理/忽略缓存"才用 `--force`。

## 数据位置(重要 — 勿误报)

**所有知识库数据都在服务器(d.youhuale.cn),不在本地。** CLI 通过 REST 上传/查询,**绝不写本地 wiki 目录**(不存在 `~/my-wiki` 之类)。本地仅以下状态文件:
- `~/.exomind/config.json` — 凭证
- `~/.exomind/cache/` — hook 的关键词/实体缓存(从服务器拉的副本)
- `~/.exomind/manifest.json` — 目录增量摄入的内容哈希清单(去重用,非知识库本身)

摄入成功后输出 `✓ 已导入服务器知识库`。若要确认数据落地,用 `exomind search <关键词>` 复查。**不要向用户报告"已保存到 ~/my-wiki/entities/X.md"等本地路径——那是错的。**

## 性能注意(ingest / query / synthesize 较慢)

这三个命令在服务器端走多次 LLM 调用(抽取实体/关系、生成摘要),弱服务器上**长内容 1-3 分钟属正常**,CLI 会在 stderr 打 `⏳` 进度提示。
- 默认超时:ingest/synthesize 5 分钟、query 3 分钟。需更长:设 `EXOMIND_TIMEOUT_MS=600000`。
- **不要用 `timeout` 命令包裹**(macOS 默认无该命令;且 CLI 自己会等)。
- 超长文本(>5 万字符)会被拒;拆成多条 ingest。

## 批量目录摄入(增量,推荐)

**本 skill 只加载一次。** 同步一个目录的多个文件,用 `--dir` 一条命令搞定——**不要**逐文件调用 Skill 或逐条 Bash:

```bash
exomind ingest --dir ~/workspace/notes --recursive        # 增量:只摄新增/改动
exomind ingest --dir ~/workspace/notes --force            # 强制全量重摄
exomind ingest --dir ~/workspace/notes --pattern "*.md"   # 默认就是 *.md
```

- **增量去重**:按文件内容 SHA-256 记在 `~/.exomind/manifest.json`,**未变的文件直接跳过**(不调 LLM),所以隔几天重跑同目录很便宜——只处理新/改文件。
- **串行 + 进度**:弱服务器上每文件 1-3 分钟,`--dir` 串行处理、stderr 打 `⏳ [i/n]`;ingest 是**同步**(不是后台异步),会一直占住到完成。
- 结束汇总:`新增 N / 更新 M / 跳过 K / 失败 J`。

## Commands

### Save knowledge
```bash
exomind ingest "内容文本" -t "描述性标题" --tag cli --tag exomind
echo "管道内容" | exomind ingest -t "标题"
exomind ingest --file ./notes.md -t "标题"
```

### Retrieve
```bash
exomind query "如何做 X?"            # LLM 问答,引用 KB 页面
exomind search "关键词" --limit 10   # 全文搜索; --rerank / --hybrid 更准
exomind entity "Redis"               # 实体详情 + 关系
exomind relations "Redis" --depth 2  # 关联实体
exomind stats                        # 知识库统计
exomind topics                       # 选题推荐
exomind gaps                         # 知识缺口(驱动摄入)
exomind daily                        # 每日摘要
exomind synthesize "主题" --depth 2  # 主题综合报告
```

### Review (FSRS-5)
```bash
exomind review                       # 待复习列表
exomind review mark "Redis" -r 3     # 1=忘记 2=吃力 3=顺利 4=轻松
```

### Feedback (drives quality ranking)
```bash
exomind feedback "entities/Redis.md" positive
```

### Output mode
Default is human-readable (colored). Add `--json` to any command for machine-readable output when piping.

## Knowledge flywheel — proactively ingest (no need to ask)

When the session produces any of the following, **immediately run `exomind ingest`** to persist it (this is the compounding flywheel — do not wait for the user to ask):

- **Key takeaways / lessons / pitfalls** — 经验总结, 踩坑记录, 心得
- **Architectural decisions with rationale** — 架构决策, 技术选型
- **Root-cause / debugging insights** — 根因分析, 调试经验
- **Performance results with concrete numbers** — 优化效果, 性能数据, 对比数据
- **Best practices / patterns** — 最佳实践, 设计模式

Rules for ingesting:
- Use a **descriptive title** (`-t`), not a generic one like "经验总结".
- Add relevant **tags** (`--tag`).
- Include the **full context** — don't omit reasoning, numbers, or trade-offs.
- One `ingest` per coherent unit of knowledge; for multiple, run several.

## When to query/search before answering

- A **deep technical question** that needs more than general knowledge → run `exomind query` or `exomind search` first, then answer using the returned context.
- "What's the relationship between X and Y?" → `exomind entity X` / `exomind relations X`.
- When relevant KB content would improve the answer, retrieve it; don't answer from memory if the KB may know better.

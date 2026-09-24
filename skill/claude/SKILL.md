---
name: exomind
description: "ExoMind knowledge base client. Load this skill FIRST (before reading files or crafting commands) whenever the user wants to save/import/ingest/存档 anything to the knowledge base — a single note, a file, a whole DIRECTORY of files, or session insights — or to query/search/review the KB. For a directory or multiple files, use `exomind ingest --dir <path>` in ONE command (incremental, auto-skip unchanged); NEVER read the files first, NEVER concat/merge them into one ingest, NEVER ingest file-by-file. Also proactively persist lessons/decisions/root-causes via `exomind ingest`."
---

# ExoMind CLI

`exomind` 是跨平台 CLI,经 REST 连接你的 ExoMind 知识飞轮(替代 Windows 上不稳定的 MCP 客户端)。一次性 `exomind login`(粘贴 `youhuale.cn/ui/account` 的 API Key)后,所有命令在 Windows / macOS / Linux 行为一致。命令报「未登录」→ 先 `exomind login`。

## 快速决策(要做什么 → 跑哪条)

| 场景 | 命令 |
|---|---|
| 保存一条知识/经验 | `exomind ingest "内容" -t "描述性标题" --tag 标签` |
| 导入目录 / 多个文件 | `exomind ingest --dir <路径>`(一条命令搞定,增量) |
| 深技术问题 / 找过往经验 | `exomind query "问题"`(LLM 问答,引用 KB 页面) |
| 关键词精确匹配 | `exomind search "关键词"`(BM25 全文) |
| 实体详情 / 关联关系 | `exomind entity X` / `exomind relations X --depth 2` |

## ⚠️ 用法铁律(必守)

1. **目录 / 多个文件 → 一条 `exomind ingest --dir <路径>`**(增量,自动跳过已摄文件)。**绝不**逐文件调用 Skill 工具、**绝不**逐条 `exomind ingest --file`、**绝不**把多个文件 `cat`/合并成一条 ingest(丢失每篇结构、无法按文件判重、易超 5 万字限)。**用 `--dir` 时不要先 `Read` 文件**——CLI 自己读,预读纯浪费上下文。
2. **Skill 工具只调用一次**(加载本文件一次即可,后续一律用 Bash 跑 `exomind ...`)。
3. ingest 是**同步**的(每文件 1-3 min),会一直占住到完成——不是后台异步,别轮询别杀。
4. **「全部跳过」= 成功**(文件已在库且内容未变),**绝不**因此擅自加 `--force` 重摄(会白白重跑 N×分钟 LLM)。只有用户**明确**说「强制刷新/全量重处理/忽略缓存」才用 `--force`。

## 主动摄入(飞轮回路,无需问用户)

会话中产生以下任一类内容,**立即 `exomind ingest` 存档**(这是复利回路,不要等用户开口):

- **关键收获 / 教训 / 踩坑** — 经验总结, 踩坑记录, 心得
- **带理由的架构决策** — 架构决策, 技术选型
- **根因分析 / 调试洞见** — 根因分析, 调试经验
- **有具体数字的性能结果** — 优化效果, 性能数据, 对比数据
- **最佳实践 / 模式** — 最佳实践, 设计模式
- **可复用知识** — 概念、方法论、心智模型、经典实践、可复用方案、蒸馏出的经验

摄入规则:标题用**描述性** `-t`(不要「经验总结」这种泛标题);加相关 `--tag`;**带全上下文**(推理、数字、取舍都别省);一个 coherent 知识单元一条 ingest,多个就跑多条。

## 先查再答(反向回路)

- 深技术问题(超出通识)→ 先 `exomind query` / `exomind search`,用返回的上下文作答。
- 「X 和 Y 什么关系?」→ `exomind entity X` / `exomind relations X`。
- KB 可能比模型记忆更了解当前语境时,先检索——别拿记忆硬答。

## 数据位置(勿误报)

**所有知识飞轮数据都在服务器(youhuale.cn),不在本地。** CLI 经 REST 上传/查询,**绝不写本地 wiki 目录**(不存在 `~/my-wiki` 之类)。本地仅三个状态文件:

- `~/.exomind/config.json` — 凭证
- `~/.exomind/cache/` — hook 的关键词/实体缓存(服务器副本)
- `~/.exomind/manifest.json` — 目录增量摄入的内容哈希清单(去重用,非知识飞轮本身)

摄入成功输出 `✓ 已导入服务器知识飞轮`。要确认数据落地用 `exomind search <关键词>` 复查。**绝不向用户报告「已保存到 ~/my-wiki/entities/X.md」等本地路径——那是错的。**

## 批量目录摄入与性能

```bash
exomind ingest --dir ~/workspace/notes --recursive        # 增量:只摄新增/改动
exomind ingest --dir ~/workspace/notes --concurrency 5    # 并发(默认3,可调高加速)
exomind ingest --dir ~/workspace/notes --force            # 强制全量重摄(见铁律4)
exomind ingest --dir ~/workspace/notes --pattern "*.md"   # 默认就是 *.md
```

- **增量去重**:按文件内容 SHA-256 记在 `~/.exomind/manifest.json`,未变文件直接跳过(不调 LLM),隔几天重跑同目录很便宜。
- **进度与汇总**:按 `--concurrency` 并发,stderr 打 `⏳ [i/n]`,结束汇总 `新增 N / 更新 M / 跳过 K / 失败 J`。
- **超时**:ingest/synthesize 默认 5 分钟、query 3 分钟;要更长设 `EXOMIND_TIMEOUT_MS=600000`。**不要用 `timeout` 命令包裹**(macOS 默认无该命令,CLI 自己会等)。超长文本(>5 万字符)会被拒,拆成多条。

## 命令参考

### 登录态
```bash
exomind login                 # 配置服务器 + 粘贴 API Key(交互式)
exomind me                    # 当前登录态/服务器/凭证(whoami 同义)
```

### 保存
```bash
exomind ingest "内容文本" -t "描述性标题" --tag cli --tag exomind
echo "管道内容" | exomind ingest -t "标题"
exomind ingest --file ./notes.md -t "标题"
```

### 检索
```bash
exomind query "如何做 X?"            # LLM 问答,引用 KB 页面
exomind search "关键词"              # BM25 全文(精确关键词匹配)
exomind search "关键词" --hybrid     # +向量语义:同义/跨语言/概念关联、字面搜不到时(如「层归一化」→Layer Normalization)
exomind search "关键词" --rerank     # +LLM 精排(最高准、慢;候选不多时)
exomind entity "Redis"               # 实体详情 + 关系
exomind relations "Redis" --depth 2  # 关联实体
exomind stats                        # 知识飞轮统计
exomind topics                       # 选题推荐
exomind gaps                         # 知识缺口(驱动摄入)
exomind daily                        # 每日摘要
exomind synthesize "主题" --depth 2  # 主题综合报告
```

### 写作(构思 → 草稿 → 发布)
```bash
exomind topics                              # 选题推荐(基于图谱密度)
exomind draft new "选题" [--account <号>]    # 生成草稿 + 保存(LLM,1-3min)
exomind draft list [--status <状态>]         # 草稿列表
exomind draft show <id>                      # 看正文
exomind draft publish <id>                   # 发布到知识飞轮(入库,走 ingest)
exomind draft wechat <id> --account <号>     # 投递公众号草稿箱(真发,返回 media_id;后台仍需群发)
```
链路:`topics` 选题 → `draft new` 生成 → `list/show` 审 → `publish` 入库 / `wechat` 发公众号。

**投公众号的参考链接写成「来源名 + 空格 + 明文 URL」一行一条**(例:`- TypeSafe 官方博客 https://typesafe.ai/blog/...`)。公众号正文不支持外部超链接,md 的 `[标题](URL)` 投到草稿箱会被过滤;URL 只写进 sources 元数据也不会进正文。投递前逐条核对 URL 在正文里且可达。

### 复习(FSRS-5)与反馈
```bash
exomind review                       # 待复习列表
exomind review mark "Redis" -r 3     # 1=忘记 2=吃力 3=顺利 4=轻松
exomind feedback "entities/Redis.md" positive   # 驱动质量排序
```

### 输出模式
默认人类可读(彩色)。管道处理时任意命令可加 `--json` 取机器可读输出。

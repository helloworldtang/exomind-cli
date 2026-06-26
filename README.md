# @exomind/cli

ExoMind 跨平台命令行客户端(Node + TypeScript)。通过 REST 与 ExoMind 知识库交互,替代 Windows 上不可用的 MCP 客户端。对标 PipeOne 的 `@pipeone/cli` + skill 模式。

- **零运行时依赖**:commander / picocolors 由 tsup 打进单文件 `dist/cli.js`,用户 `npm i -g` 后无需 `node_modules` 即可运行(基于 Node 18+ 全局 `fetch`)。
- **跨平台**:Windows PowerShell / macOS / Linux 行为一致。
- **服务器零改动**:命令与 `src/exo/api/query.py` 的 REST 端点 1:1,认证走 `Authorization: Bearer`。

## 开发

```bash
cd clients/cli
npm install          # 安装 devDependencies
npm run build        # tsup 打包 → dist/cli.js
npm test             # node:test 单元测试(hook 触发 / config / api / format)
node dist/cli.js --help
```

### 项目结构

```
src/
  cli.ts          commander 入口 + 全局选项 + 错误处理
  config.ts       ~/.exomind/config.json 读写 + 向后兼容旧 key
  api.ts          fetch 封装(Bearer / 超时 / 错误归一)
  format.ts       人类可读(--json 双模)
  io.ts           stdin / 文件读取
  hook.ts         UserPromptSubmit 钩子(替代 exomind-context.sh)
  commands/       每个命令一个文件(ingest/query/search/...)
skill/
  SKILL.md        Claude Code skill 源(install 时拷贝)
test/             node:test 单元测试
```

### 测试

- 单元:`npm test`(tsx 直跑 .ts,覆盖 hook 触发正则、config 往返+兼容、api 错误归一、format 双模)。
- 端到端:仓库根 `tests/test_exomind_remote_cli.py`——启动本地 `exo.api.query:app`,对 `dist/cli.js` 跑真实 HTTP(stats/search/entity/hook 注入/连接错误)。

```bash
# 在仓库根
.venv/bin/python -m pytest tests/test_exomind_remote_cli.py -v
```

## 发布到 npm

```bash
npm run build                 # 构建(prepublishOnly 会自动跑)
npm pack                      # 本地预览 tarball(可选)
npm version patch             # bump 版本
npm publish --access public   # 发布(公开,scope @exomind 需 --access public)
```

> 包含文件由 `package.json` 的 `files: ["dist", "skill"]` 控制——只发布构建产物与 skill,不含 src/test。

## 设计要点

- **CJS 输出**:tsup `format: cjs`,避免 ESM 打包 CJS 依赖时 `Dynamic require of "events"` 问题;bin 顶部带 shebang。
- **凭证类型无关**:`exomind login` 存入的字符串以 `Bearer` 发送,服务器 `auth_middleware` 同时接受 API Key 与 GitHub token(`gh_`)。
- **hook 弱服务器友好**:`/keywords` 本地缓存 1h,实体描述按 miss 拉取并缓存,per-prompt 命中缓存即零服务器命中;无需同步本地 wiki。

## 相关文档

- [CLI 命令指南](./docs/cli-guide.md)
- 新机器接入(含 Claude Code/GLM 配置)见服务端仓库 `myExoMindManager/docs/new-machine-setup.md`

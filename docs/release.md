# 发版流程（发布到 npm）

> 一句话：把 `v*` tag 推到 GitHub，Release 工作流自动构建并发布到 npm，**并自动创建 GitHub Release**（Releases 页有条目 + published 通知邮件——Actions 成功默认不发邮件、npm 也不发，Release 是唯一的成功可见信号，v0.17.0 曾因此被误判未发布）。
**上传前先自检**（`scripts/preflight.mjs`）——四类「发了才发现」的问题在这里就被挡住：tag 与版本不一致、`bin` 带 `./` 前缀（npm 会静默剥掉 bin，装了没命令）、`files` 漏掉入口、版本已存在于 registry（403）。
> **本机不需要登录 npm** —— 发布凭据是仓库 secret `NPM_TOKEN`，在 GitHub 的机器上使用。
> **成功的可见信号有三条**：自动建 GitHub Release、workflow Summary 打出版本与包页面、发布后自动轮询 registry 确认版本真的可见（这一步不通过会让 job 变红）。

## 原理

`.github/workflows/release.yml` 监听 `v*` tag（也可在 Actions 页面手动触发）：

构建（`npm ci` + `npm run build`）→ **上传前自检**（`node scripts/preflight.mjs`）→ `npm publish --provenance --access public` → **复核 registry**（轮询到版本可见为止，最多 3 分钟）。

自检必须跑在 build 之后——`bin` 指向的是 `dist/` 构建产物，没 build 过会被拦下。

发布内容由 `package.json` 的 `files: ["dist", "skill"]` 控制——只发构建产物与 skill，不含 src/test。

## 五步（日常发版）

1. **代码 push 到 main** —— 自动跑 CI（构建 + 测试），只验证、不发布。
2. **升版本号**（修复/加固 → patch；新功能 → minor；不兼容 → major）：
   ```bash
   npm version patch   # 0.14.0 → 0.14.1；自动建 commit + 打 v0.14.1 tag
   ```
3. **推 tag**：
   ```bash
   git push --follow-tags
   ```
4. **等流水线**：GitHub → Actions →「Release」run 变绿（通常 1 分钟内），绿了 Releases 页会自动出现该版本条目。
5. **验证**：这一步**流水线已经做了**（发布后轮询 registry，3 分钟内没出现就让 job 红，不用你记着查）。想手动复核时（用具体版本号查，绕开 `latest` 的 CDN 缓存；注册表传播有约 3 分钟延迟）：
   ```bash
   npm view exomind@<版本号> version   # 应输出该版本号
   ```

> `npm version` 支持自定义提交信息：`npm version patch -m "release: v%s — <本版说明>"`。

## 首次配置（仅一次；换机器 / 换 token 时重做）

在 npm 建 **Granular Access Token**（bypass 2FA，仅 `exomind` 包写权限），写入仓库 secret：

```bash
gh secret set NPM_TOKEN --repo helloworldtang/exomind-cli
```

（粘贴 token，不进 shell 历史。）

## 常见问题

- **本机要登录 npm 吗？** 不用。发布在 GitHub 上用 `NPM_TOKEN` 完成。
- **同一版本号能重发吗？** 不能，必须 bump 新号（`npm publish` 不可覆盖）。
- **tag 和工作流对不上？** 工作流只认 `v*`；tag 名与 `package.json` 版本保持一致（`npm version` 会自动做对）。
- **发布出问题了怎么办？** 直接再发一个 patch 修复；必要时用 `npm deprecate exomind@<版本> "<原因>"` 标记问题版本。
- **改了发布工作流或 preflight 怎么试跑？** Actions 页面手动触发「Release」并勾 `dry_run=true`：只跑构建 + 自检，不发布。**别拿真版本试**——版本已发布时重发必然 403，等于「改坏了也测不出来」。试跑后确认 `发布到 npm` / `确认版本已在 registry 可见` / `建 GitHub Release` 三步显示 skipped。
- **本机怎么先跑一遍自检？** `npm run build && node scripts/preflight.mjs --skip-registry`（`--skip-registry` 跳过联网查重；已验证过的版本加 `--allow-published` 可把「已存在」降级为提示）。

## 发布历史

| 版本 | 日期 | 方式 | 结果 |
|------|------|------|------|
| v0.13.0 | 2026-09-12 | 推 `v*` tag → Release 工作流 | 成功 |
| v0.13.1 | 2026-09-12 | 同上 | 成功 |
| v0.14.0 | 2026-09-13 | 同上 | 成功 |
| v0.14.1 | 2026-09-15 | 同上 | 成功 |
| v0.15.0 | 2026-09-15 | 同上 | 成功（首推网络超时，重试成功） |
| v0.16.0 | 2026-09-15 | 同上 | 成功（GitHub 首推超时一次，用户开 VPN 后重推成功） |
| v0.17.0 | 2026-09-17 | 同上 | 成功 |
| v0.17.1 | 2026-09-17 | 同上 | 成功（注册表传播延迟约 3 分钟，publish 日志实锤 `+ exomind@0.17.1`；GitHub Release 本版起补建） |
| v0.17.2 | 2026-09-19 | 同上 | 成功（cleanupStale 修复） |

（更早的 v0.6–v0.12 亦为相同方式。）

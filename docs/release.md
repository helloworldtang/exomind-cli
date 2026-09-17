# 发版流程（发布到 npm）

> 一句话：把 `v*` tag 推到 GitHub，Release 工作流自动构建并发布到 npm。
> **本机不需要登录 npm** —— 发布凭据是仓库 secret `NPM_TOKEN`，在 GitHub 的机器上使用。

## 原理

`.github/workflows/release.yml` 监听 `v*` tag（也可在 Actions 页面手动触发）：

构建（`npm ci` + `npm run build`）→ `npm publish --provenance --access public`。

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
4. **等流水线**：GitHub → Actions →「Release」run 变绿（通常 1 分钟内）。
5. **验证**：
   ```bash
   npm view exomind version   # 应输出新版本号
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

（更早的 v0.6–v0.12 亦为相同方式。）

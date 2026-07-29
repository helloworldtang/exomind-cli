# exomind-cli

npm 包 `exomind`(TypeScript + commander + tsup),用户态 CLI,通过 REST 调 myExoMindManager(youhuale.cn)。独立仓库(remote: helloworldtang/exomind-cli)。

## 发版铁则:改了代码必须 bump 版本 + push tag(否则 npm 不更新)

npm 发布由 **GitHub Action 在收到 tag 时触发** `npm publish`。**只 push commit、不 push tag,不会发 npm;tag 是触发器。**

- **任何代码改动都要 bump 版本**:`npm version patch`(纯文案/小修)/ `minor`(新命令/新选项/行为变更)/ `major`(破坏性)。
- `npm version` 要求**工作树干净**,顺序:
  1. 改 src/
  2. `npm run build`(tsup → dist/cli.js,**dist/ gitignored,不用提交**)
  3. `npm test`(`node --test --import tsx test/*.test.ts`,无网络/服务器依赖)
  4. **先 commit 代码改动**(工作树必须干净,npm version 才肯跑)
  5. `npm version patch`(自动 commit package.json 版本号 + 打 tag `vX.Y.Z`)
  6. `git push origin main --tags` → GA 自动 `npm publish`(`prepublishOnly: npm run build` 会重建 dist/)
- tag 首次 push 偶发 GitHub 443 超时,重试 `git push origin vX.Y.Z` 即过。
- **commit message 不加 Co-Authored-By**(全局规则)。

## 构建 / 测试 / 本地试用

- 构建:`npm run build`(tsup → dist/cli.js)。
- 测试:`npm test`(61 测试,无网络/服务器依赖)。
- 本地试用:`npm run build && node dist/cli.js <cmd>`,或 `npm link` 后直接 `exomind <cmd>`。

## 结构

- `src/cli.ts`:commander 命令注册(各命令 + 选项)。
- `src/commands/*.ts`:各命令实现(draft / ingest / ...)。
- `src/api.ts`:REST 客户端(ApiClient.post/get)+ opTimeout(各操作超时)。
- 命令 → ApiClient → myExoMindManager REST API。

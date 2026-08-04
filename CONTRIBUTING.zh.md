# 贡献于 pi-claudian

[English](CONTRIBUTING.md) | [中文](CONTRIBUTING.zh.md)

感谢你有意改进 pi-claudian！欢迎各种贡献——bug 报告、功能想法、新扩展、文档或修复。

## 快速开始

需要 Node.js 20+ 与 [pnpm](https://pnpm.io)（仓库通过 corepack 固定 `pnpm@11.15.1`）。

```sh
git clone https://github.com/licongy/pi-claudian.git
cd pi-claudian
pnpm install
pnpm typecheck
```

验证你的环境：

```sh
pnpm typecheck   # 对所有包执行 tsc --noEmit
pnpm lint        # prettier --check .
pnpm format      # prettier --write .（修复格式）
```

## 项目结构

- `packages/*` 下每个目录对应一个可发布的扩展。
- 每个包将 `index.ts` **源码**发布到 npm；Pi 通过
  [jiti](https://github.com/unjs/jiti) 加载，因此没有构建或 `dist/` 步骤。
- 共享的 TypeScript 配置位于 `tsconfig.base.json`（`noEmit`）；每个包都继承它。`tsc`
  仅用于类型检查。
- `@earendil-works/pi-coding-agent` 是一个 peer 依赖（仅类型）——绝不将其打包进某个包
  的已发布文件中。

完整约定见 [AGENTS.md](AGENTS.md)。

## 新增扩展

1. 创建 `packages/<name>/`，包含一个导出默认工厂
   `(pi: ExtensionAPI) => void | Promise<void>` 的 `index.ts`。
2. 从已有包复制结构（`packages/sync-title/` 是不错的模板）：`package.json`、
   `tsconfig.json`、`README.md` 以及 `debug.ts` 助手。
3. 在 `package.json` 中，将 `pi` manifest 指向 `.ts` 源码，添加 `pi-package` 关键字，
   并列出源文件（无 `dist/`）：

   ```json
   {
     "keywords": ["pi-package", "pi-extension"],
     "pi": { "extensions": ["./index.ts"] },
     "files": ["index.ts", "debug.ts", "README.md"]
   }
   ```

4. 将其添加到根 `README.md` 的 Extensions 表格中。

## 修改代码

- 保持一次变更聚焦——每个 pull request 对应一个功能或修复。
- 遵循既有代码风格（由 Prettier 强制约束）。运行 `pnpm format`。
- 除非注释能解释不明显的意图，否则不要添加注释。
- 诊断输出请使用 `debug.ts` 助手（受 `PI_CLAUDIAN_DEBUG` 控制），而非直接用
  `console.log`。
- 开 PR 前，确保 `pnpm typecheck` 与 `pnpm lint` 通过。

## 调试

用一个环境变量即可为所有 `@pi-claudian` 扩展开启调试日志（输出走 stderr，绝不与 Pi 的
stdout 混在一起）：

```sh
PI_CLAUDIAN_DEBUG=1 pi              # 内联显示调试输出
PI_CLAUDIAN_DEBUG=1 pi 2>debug.log  # 捕获到文件
```

## 发布

发布由 [Changesets](https://github.com/changesets/changesets) 管理。任何面向用户的变更，
都从仓库根目录添加一个 changeset：

```sh
pnpm changeset
```

将生成的 changeset 文件与你的代码一起提交。维护者会运行 `pnpm version` 与
`pnpm release` 来发布。你**无需**自行发布。

## 报告 bug 与提需求

提交一个 [GitHub Issue](https://github.com/licongy/pi-claudian/issues)，选择 Bug 报告或
功能请求模板。越可复现越好。

## 找点事做

留意带
[`good first issue`](https://github.com/licongy/pi-claudian/labels/good%20first%20issue)
或
[`help wanted`](https://github.com/licongy/pi-claudian/labels/help%20wanted)
标签的 issue。如果你有新扩展的想法，请先开 issue 讨论范围。

## 提问与讨论

开放式问题或想法，请发起
[GitHub Discussion](https://github.com/licongy/pi-claudian/discussions)。

## 行为准则

友善且建设性。我们在精神上遵循
[Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/)。
不会容忍不可接受的行为。

## 许可证

通过贡献，你同意你的贡献将在 [MIT License](LICENSE) 下授权。

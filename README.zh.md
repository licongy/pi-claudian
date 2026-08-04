# pi-claudian

[![npm version](https://img.shields.io/npm/v/@pi-claudian/sync-title?style=flat&colorA=222222&colorB=CB3837)](https://www.npmjs.com/package/@pi-claudian/sync-title)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org)

[English](README.md) | [中文](README.zh.md)

一个由独立发布的 [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) 扩展组成的
monorepo，用于与 [Claudian](https://github.com/claudian) 协作。

每个扩展都位于 `packages/*` 下各自的包中，并以 TypeScript 源码形式发布到 npm（Pi 通过 jiti
加载，无需构建步骤），因此你只需安装所需的部分：

```
pi install npm:<package-name>
```

## 扩展

| 包                                                   | 描述                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------- |
| [`@pi-claudian/sync-title`](packages/sync-title)     | 将 Claudian 的会话标题同步到 Pi 的会话名称中，使其出现在 `/resume` 里。 |
| [`@pi-claudian/sync-session`](packages/sync-session) | 将 Pi 的 `/tree`、`/clone` 与 `/fork` 会话变更同步到 Claudian 的会话元数据中。    |

## 开发

需要 Node.js 20+ 与 [pnpm](https://pnpm.io)。

```sh
pnpm install      # 安装依赖
pnpm typecheck    # 对所有包进行类型检查（tsc --noEmit）
pnpm lint         # 用 prettier 检查格式
pnpm format       # 用 prettier 修复格式
```

## 调试

所有 `@pi-claudian` 扩展共享一个调试开关。设置一个环境变量即可在 stderr 上追踪每个扩展
（绝不会与 Pi 的 stdout 混在一起）：

```sh
PI_CLAUDIAN_DEBUG=1 pi              # 内联显示调试输出
PI_CLAUDIAN_DEBUG=1 pi 2>debug.log  # 捕获到文件
```

## 发布

本仓库使用 [Changesets](https://github.com/changesets/changesets) 对每个扩展进行独立的版本
管理与发布。

```sh
pnpm changeset    # 描述一次变更（生成一个 changeset 文件）
pnpm version      # 应用 changesets -> 升级版本、更新 CHANGELOG
pnpm release      # 发布所有有变更的包到 npm
```

详见 [`.changeset/README.md`](.changeset/README.md)。

> `pnpm version` 与 `pnpm release` 均要求工作区是干净的
> （`scripts/check-clean.mjs`）。这能避免从一个发布标签所不指向的状态进行发布——最常见的
> 原因是在版本化前忘记提交源码/changeset 文件，或在发布前忘记提交版本升级。典型流程：
>
> ```sh
> pnpm changeset && git add -A && git commit -m "add changeset"  # 提交变更 + changeset
> pnpm version && git add -A && git commit -m "version packages"  # 提交版本升级
> pnpm release                                                   # 干净工作区 -> 标签落在已发布代码上
> ```

## 贡献

欢迎各种贡献——bug 报告、功能想法、新扩展或修复。入门请参阅
[CONTRIBUTING.md](CONTRIBUTING.md)。

快捷入口：

- [提交 issue](https://github.com/licongy/pi-claudian/issues)
- [发起讨论](https://github.com/licongy/pi-claudian/discussions)
- 留意 [`good first issue`](https://github.com/licongy/pi-claudian/labels/good%20first%20issue) /
  [`help wanted`](https://github.com/licongy/pi-claudian/labels/help%20wanted) 标签

刚接触本代码库？[`packages/sync-title`](packages/sync-title) 是一个极简、保持最新模板，新增
扩展时可直接照搬。

## 许可证

[MIT](LICENSE)

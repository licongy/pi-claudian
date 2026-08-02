# @pi-claudian/sync-session

[![npm version](https://img.shields.io/npm/v/@pi-claudian/sync-session?style=flat&colorA=222222&colorB=CB3837)](https://www.npmjs.com/package/@pi-claudian/sync-session)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

[English](README.md) | [中文](README.zh.md)

一个 [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) 扩展，在
[Claudian](https://github.com/claudian) 与 Pi 之间搭起桥梁：它把 Pi 的会话树变更
（`/tree`、`/fork`、`/clone`）同步进 Claudian 的会话元数据，使你在 Pi 内部分支或
fork 之后，Claudian 对该会话的视图保持正确。

## 为什么需要

Claudian 将每个会话的元数据存放在 `.claudian/sessions/conv-*.meta.json` 中。对于
Pi 提供方的会话，它会在 `providerState.leafEntryId` 中记录 Pi 会话树中的活跃位置，
同时保存 `sessionFile` 和 `sessionId`。Claudian 从不监听 Pi 的变更，因此两项 Pi 操作
会让这些元数据过期：

- **`/tree`** 在**同一个会话文件**内将活跃叶子移动到更早的条目（可选地追加一段分支
  摘要）。Claudian 仍指向旧的叶子，因此在 Claudian 中恢复该会话时会打开错误的分支。
- **`/fork` / `/clone`** 会创建**新的会话文件和 UUID**。Claudian 中没有对应新会话的
  会话记录，因此它永远不会出现在 Claudian 的列表里。

本扩展补上了 Pi → Claudian 这一方向的缺口。

## 安装

```
pi install npm:@pi-claudian/sync-session
```

## 用法

自动：

- **`/tree`**（或通过快捷键进行树导航）之后，新的叶子 id 会被写入与之匹配的 Claudian
  会话的 `providerState.leafEntryId` 中。
- **`/fork`** / **`/clone`** 之后，会为 fork 出的会话创建一个新的 `conv-*.meta.json`，
  复制源会话的标题/模型，并指向新的 `sessionFile` / `sessionId` / `leafEntryId`。该
  fork 随即会出现在 Claudian 的会话列表中。

手动：运行 **`/sync-session`** 按需重新同步当前叶子。

**同步摘要** —— 在 `/tree`、`/fork` 或 `/sync-session` 之后，结果会以多行列表的形式
展示受影响的会话（此处是一次本已同步的 `/sync-session`）。没有任何操作是静默的：

![Pi TUI 展示 sync-session 命令以及一段多行摘要，列出被同步的会话及其 id 与名称](https://raw.githubusercontent.com/licongy/pi-claudian/master/packages/sync-session/screenshot.png)

## 行为

- 优先按 Pi 会话 id 匹配 Claudian 元数据文件，回退到 `providerState.sessionFile` 路径。
- Fork 会话会继承源会话的标题，以便立即识别；`@pi-claudian/sync-title` 会在下一轮
  协调 Pi 的名称。
- Fork 创建是幂等的：如果 Claudian 中已存在该 fork 会话对应的会话（例如 Claudian 自身的
  fork 转换已经运行过），则会协调叶子，而不是重复创建会话。
- 仅触碰 `pi` 提供方的会话；其他提供方保持不动。
- 写入 Claudian 是原子的（临时文件 + 重命名），因此 Claudian 永远不会读到写了一半的元
  数据文件。
- 在非 Claudian 管理的 vault（如纯 TUI 会话）中静默无操作。

### Claudian → Pi（fork 转换）

本扩展不会把 Claudian 侧的 fork 同步回 Pi —— 无此必要。当 Claudian 对一个基于 Pi 的
会话进行 fork 时，它本身就会创建 Pi 会话文件（以及匹配的 `.claudian/sessions` 会话），
因此 Claudian fork 之后 Pi 侧已经是最新的。

背景说明：Claudian 为其自身的会话拥有 Pi 会话生命周期的所有权，并在自己的进程中执行
fork 转换，而会话作用域的 Pi 扩展无法可靠地观察到这一过程。因此本扩展专注于相反方向
（Pi → Claudian），这也是 Claudian 自身不会做的事。

## 调试

启用共享的 `@pi-claudian` 调试开关即可追踪匹配与写入过程（输出走 stderr）：

```sh
PI_CLAUDIAN_DEBUG=1 pi              # 内联显示调试输出
PI_CLAUDIAN_DEBUG=1 pi 2>debug.log  # 捕获到文件
```

留意带 `[pi-claudian]` 标记的行，例如 `synced leaf:` 或 `created fork conversation:`。

## 许可证

MIT

# @pi-claudian/sync-title

[![npm version](https://img.shields.io/npm/v/@pi-claudian/sync-title?style=flat&colorA=222222&colorB=CB3837)](https://www.npmjs.com/package/@pi-claudian/sync-title)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

[English](README.md) | [中文](README.zh.md)

一个 [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) 扩展，在
[Claudian](https://github.com/claudian) 与 Pi 之间搭起桥梁：它对 Claudian 的会话标题
与 Pi 的会话名称进行双向同步，无论标题来自 Claudian 的自动生成还是来自 Pi 的 `/name`
命令，二者始终保持一致。

## 为什么需要

Claudian 将每个会话的元数据存放在 `.claudian/sessions/conv-*.meta.json` 中（其中包含
一个自动生成的 `title`），但从不会告知 Pi；而 Pi 的 `/name` 命令也从不会告知 Claudian。
本扩展在两个方向上补上了这个缺口，并采用一种绝不会静默覆盖你手动设置的名称的冲突解决
策略。

## 安装

```
pi install npm:@pi-claudian/sync-title
```

## 用法

自动：在对话打开/恢复时以及每轮 agent 回合之后都会协调标题。无需任何操作。

手动：运行 `/sync-title` 命令按需协调当前会话（会在冲突时提示你选择，并在 Claudian 标题
尚未生成完成时持续重试）。

批量：运行 `/sync-title-all` 一次性协调当前 vault 内**所有** Claudian 会话。这用于解决
那些只跑了一轮就退出、再也没被恢复过的会话——它们的 Pi 会话名之所以一直是空的，正是因为
按会话的同步只在打开/每轮时触发。它是非破坏性的：仅在两个方向上填补空名称（Claudian →
Pi、Pi → Claudian），遇到冲突则**跳过而不覆盖**，并把冲突列出，方便你逐个用 `/sync-title`
解决。当前会话走实时 API 同步；其余会话通过向其 jsonl 追加一条 `session_info` 条目来同步，
Pi 在下次恢复时会读取到。写入前会先展示计划并请你确认。

## 行为

本扩展依据一张决策表，将 Pi 会话名称与 Claudian 标题进行协调：

| Pi 名称 | Claudian 标题                       | 操作                                                |
| ------- | ----------------------------------- | --------------------------------------------------- |
| 空      | 空                                  | 等待并重试（标题尚未就绪）                          |
| 空      | 已就绪                              | Claudian → Pi                                       |
| 已就绪  | 空                                  | Pi → Claudian（Claudian 仍在生成时跳过）            |
| 已就绪  | 相同                                | 无操作                                              |
| 已就绪  | 不同（自动触发）                    | 仅通知，保留 Pi 名称                                |
| 已就绪  | 不同（手动 `/name`、`/sync-title`） | 提示：Pi→Claudian / Claudian→Pi / 两者都保留 / 取消 |

说明：

- **同步时机**：在对话打开或恢复时（主要的同步点——此时 Claudian 的元数据已完整落盘，
  标题会被立即拉取）以及每轮 agent 回合之后。
- Claudian 在**首轮之后**才异步生成对话标题，并在那时才把 Pi 会话 id 关联进元数据。当
  标题尚未就绪时，本扩展会等待并以退避方式持续重试（总计约 2 分钟），而非首次失败即放弃。
- 优先按 Pi 会话 UUID 匹配 Claudian 元数据文件，回退到 `providerState.sessionFile` 路径
  （经 `fs.realpath` 比较，因此符号链接化的 vault 也能匹配）。
- **vault 解析**使用会话自身的家目录（`ctx.cwd`，Pi 会将其设为所恢复会话记录的 `cwd`，
  而非 `process.cwd()`），向上查找最近的 `.claudian/sessions`。因此从 vault 的子目录恢复
  一个 Claudian 会话仍能正确同步。
- 绝不静默覆盖你自行命名的会话：自动触发（回复之后）在两者不一致时仅通知；交互式触发则
  让你选择同步 Pi→Claudian、Claudian→Pi、两者都保留或取消。
- 清除：用 `/name` 清空 Pi 名称（设为空）**不会**擦除 Claudian 的标题。
- 在非 Claudian 管理的 vault（如纯 TUI 会话）中静默无操作。即使在 Claudian vault 内直接
  运行的纯 `pi` 会话也不会受影响：尚未关联的元数据仅在会话启动时探测一次，因此不会产生
  每轮重试的噪声。
- 当 Claudian 标题状态为 `pending` 时，本扩展会等待，而不是写回一个会与生成器竞态的 Pi
  名称。
- 写回 Claudian 是原子的（临时文件 + 重命名），因此 Claudian 永远不会读到写了一半的元
  数据文件。

**交互式冲突提示** —— 当 `/name` 或 `/sync-title` 时两者不一致便会显示。未经你同意，
Claudian 绝不会被覆盖：

![交互式冲突解决提示：同步 Pi → Claudian、Claudian → Pi、两者都保留或取消](https://raw.githubusercontent.com/licongy/pi-claudian/master/packages/sync-title/screenshot.png)

## 调试

启用共享的 `@pi-claudian` 调试开关即可追踪匹配、重试与写入过程（输出走 stderr）：

```sh
PI_CLAUDIAN_DEBUG=1 pi              # 内联显示调试输出
PI_CLAUDIAN_DEBUG=1 pi 2>debug.log  # 捕获到文件
```

留意带 `[pi-claudian]` 标记的行，例如 `writing session name from Claudian` 或
`conflict — prompting user`。

## 许可证

MIT

# @pi-claudian/auto-save-to-markdown

[![npm version](https://img.shields.io/npm/v/@pi-claudian/auto-save-to-markdown?style=flat&colorA=222222&colorB=CB3837)](https://www.npmjs.com/package/@pi-claudian/auto-save-to-markdown)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

[English](README.md) | [中文](README.zh.md)

一个 [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) 扩展：每轮对话完成后，自动把当前对话分支保存为带 YAML frontmatter 的 markdown 文件——每个会话树分支一个文件。

## 为什么需要它

Pi 内部以 JSONL 树的形式记录会话，便于恢复却不便于阅读、检索和归档。本扩展在你工作的同时把对话镜像成普通 markdown 文件，每轮交流都以任何编辑器、笔记软件或 grep 都能处理的格式留存，且模型、费用、token 数等元数据都写在 frontmatter 里。

## 安装

```
pi install npm:@pi-claudian/auto-save-to-markdown
```

## 用法

自动：每个 agent 轮次完全结束（`agent_settled`，含自动重试与压缩全部完成）后，当前对话分支写入 `<cwd>/<文件夹>/<标题>-<tree>-<时间>.md`。

手动：运行 `/save-conversation` 立即保存当前分支并显示文件路径。

## 配置

目标文件夹由环境变量 `PI_SAVE_CONVERSATION_DIR` 控制（Pi 没有扩展设置 API）：

| 取值        | 保存位置                          |
| ----------- | --------------------------------- |
| 未设置      | `<cwd>/ai-conversations/`（默认） |
| `.` 或 `""` | 直接保存在 `<cwd>/`               |
| `notes/ai`  | `<cwd>/notes/ai/`                 |
| `/绝对路径` | 该绝对路径                        |

```bash
PI_SAVE_CONVERSATION_DIR=notes/ai pi
```

## 文件名与 frontmatter

文件名：`<标题>-<tree>-<时间>.md`

- `<标题>` — 会话名称（`/name`）；未命名时取第一条用户消息的摘要
- `<tree>` — 建文件时分支上最深一条消息的 entry id（分支标识）
- `<时间>` — 建文件的本地时间，格式 `YYYYMMDD-HHmmss`

```markdown
---
title: "修复登录重定向死循环"
session_id: "d0a4f541-976d-4d1b-8e1c-30a1f2b3c4d5"
tree: "a1b2c3d4"
model: "claude-sonnet-4-5"
provider: "anthropic"
cost: 0.023401
tokens: 18745
tokens_input: 15230
tokens_output: 3515
tokens_cache_read: 0
tokens_cache_write: 0
messages: 8
created: "2026-08-29T05:05:12.000Z"
updated: "2026-08-29T05:42:10.000Z"
project_root: "/Users/me/project"
session_file: "~/.pi/agent/sessions/--Users-me-project-20260829-050500_ab12.jsonl"
---

# 修复登录重定向死循环

User · 13:05:12
===

auth 重构之后登录页一直重定向死循环……

---

Assistant · 13:05:40 · claude-sonnet-4-5
===

<details>
<summary>Thinking</summary>

先看中间件的执行顺序……

</details>

我先追踪一下中间件链。

**Tool calls**

- `read` — {"filePath":"/Users/me/project/src/auth/middleware.ts"}

> **Tool · read** /Users/me/project/src/auth/middleware.ts — 120 lines …

---
```

正文完整渲染 user / assistant 消息（assistant 的 thinking 放在可折叠的
`<details>` 块中），每个工具调用和结果各压缩成一行摘要，既可读又能看出
agent 做了什么。

每个消息块以 setext 一级信息头（`User · …`，下一行以 `===` 下划）开头——
高于 AI 内容常见的 `##` 二级标题，解析时也能与内容中的 `#` 一级标题区分
开——并以"上下各一个空行"包裹的 `---` 分隔线结尾（多余空行会被裁剪），
无论是阅读还是程序化切分，都能清楚地区分每个消息块。

### 碎片化 thinking 修复

部分上游推理流（在 z-ai/GLM 经 OpenRouter 的场景中观察到）会把 thinking
存成一词一行、甚至一字一行：原始空格塌缩成碎片行开头的单个空格，碎片之间
被成串的换行拼接。扩展会检测这种损坏（依据带单个前导空格的行、或大量
1–2 字符碎片行），把碎片重新接回通顺的文本，保存的 thinking 不再一行
一词。正常的 thinking 块原样保存，不做任何改动。

`cost` 和 token 字段统计整条已保存分支，且包含缓存 token（按供应商缓存
价格计费），因此总计可与供应商侧账单（如 OpenRouter Activity）对照。未
进入会话树的请求（失败重试、共用同一 API key 的其他会话）不在其中。

## 分支行为

Pi 会话是树：`/tree` 导航到更早的位置后再提问就分出新的分支。每个
markdown 文件只记录**一个分支**——即该分支看到的 root→leaf 完整路径。

- **同一分支继续对话** → 新消息*追加*到已有文件，frontmatter（`cost`、
  `tokens`、`messages`、`updated`、标题、模型）同步刷新。
- **`/tree` 后重新提问（不同分支）** → _另存新文件_，内容为新分支的完整
  路径（共享前缀 + 新对话）。
- **在当前末端分叉** → 已有文件继续追加（其内容恰好是新分支的精确前缀），
  不会产生重复文件。
- **之后恢复会话**（重启、`/resume`、`/fork`、`/clone`）→ 分支被识别，
  对应文件从上次的位置继续。

分支状态以扩展 custom entry 的形式持久化在会话树内部（不进 LLM 上下文、
不在 TUI 渲染），因此无需任何辅助文件即可在重启和导航后恢复状态。

被压缩（compaction）过的会话导出的仍是**完整原始历史**——归档永远是全量
对话，而不是压缩后的上下文。

## 调试

```bash
PI_CLAUDIAN_DEBUG=1 pi
```

## 许可

MIT

# pi-auto-save-to-markdown

[![npm version](https://img.shields.io/npm/v/pi-auto-save-to-markdown?style=flat&colorA=222222&colorB=CB3837)](https://www.npmjs.com/package/pi-auto-save-to-markdown)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

[English](README.md) | [中文](README.zh.md)

一个 [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) 扩展：每轮对话完成后，自动把当前对话分支保存为带 YAML frontmatter 的 markdown 文件——每个会话树分支一个文件。

## 为什么需要它

Pi 内部以 JSONL 树的形式记录会话，便于恢复却不便于阅读、检索和归档。本扩展在你工作的同时把对话镜像成普通 markdown 文件，每轮交流都以任何编辑器、笔记软件或 grep 都能处理的格式留存，且模型、费用、token 数等元数据都写在 frontmatter 里。

## 安装

```
pi install npm:pi-auto-save-to-markdown
```

## 用法

自动：每个 agent 轮次完全结束（`agent_settled`，含自动重试与压缩全部完成）后，当前对话分支写入 `<cwd>/<文件夹>/<标题>-<key>-<时间>.md`。

手动：运行 `/save-conversation` 立即保存当前分支并显示文件路径。

批量：运行 `/save-conversation-all` 保存**当前项目的全部 session**——即项目的
`~/.pi/agent/sessions/<编码后的 cwd>/` 目录下的全部 session jsonl。每个 session
都走与实时保存完全相同的管线（候选链、绝不覆盖守卫、标题追认重命名、恢复告警），
归档写入**该 session 自己的工作目录**下，与在其中运行 `/save-conversation` 落点完全
一致。当前 session 最先经正常实时路径保存。细节：

- **幂等**。重复运行只续写或逐 session 报告"up to date"，绝不重复建文件。
- **跳过**没有任何 assistant 回复的 session（无可归档的对话内容）与 `id/parentId`
  结构之前的远古遗留文件。
- **推迟**（defer）保存期间 jsonl 发生变化的 session（其运行时仍在写入）：保存只在
  文件自读取后未被改动时才继续。被推迟的 session 由其运行时或下一轮批量自然补齐。
- **汇报**汇总——`N saved, M up to date, K skipped, …`——异常情况逐 session 告警
  （附 session id 前 8 位标识）。

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

文件名：`<标题>-<key>-<时间>.md`

- `<标题>` — 会话名称（`/name`）；未命名时取第一条用户消息的摘要
- `<key>` — session id 的 SHA-256 前 8 位十六进制：同一会话的所有文件相同，恢复、重启后仍天然聚簇（session id 尚不存在时，改以同样方式哈希分支上最深一条消息的 entry id——key 始终是 8 位十六进制的不透明聚簇键）
- `<时间>` — 建文件的本地时间，格式 `YYYYMMDD-HHmmss`

会话的真实名称在建文件之后才到达时（如 Claudian 在首轮回复后才生成标题），下一次保存会把文件一次性改名为 `<名称>-<key>-<原时间戳>.md`（保留原创建时间戳），并同步改写 frontmatter 标题与正文标题。改名至多发生一次：之后的 `/name` 改名不再影响文件名，手动整理过的文件名也不会被动。

```markdown
---
title: "修复登录重定向死循环"
agent: "pi"
format_version: "1.3"
session_id: "d0a4f541-976d-4d1b-8e1c-30a1f2b3c4d5"
session_key: "c2088d77"
branch_last_entry_id: "019be3a2-1f4d-7c8a-9b01-d23e45f6a7b8"
model: "z-ai/glm-5.3"
provider: "openrouter"
cost: 0.023401
tokens: 18745
tokens_input: 15230
tokens_output: 3515
tokens_cache_read: 0
tokens_cache_write: 0
messages: 8
created: "2026-08-29T13:05:12+08:00"
updated: "2026-08-29T13:42:10+08:00"
project_root: "/Users/me/project"
session_file: "~/.pi/agent/sessions/--Users-me-project-20260829-050500_ab12.jsonl"
---

# 修复登录重定向死循环

User <span style="font-size: 0.5em; color: var(--text-faint);">2026-08-29 13:05:12</span>
===

auth 重构之后登录页一直重定向死循环……

---

Assistant <span style="font-size: 0.5em; color: var(--text-faint);">2026-08-29 13:05:40 · claude-sonnet-4-5</span>
===

> [!tldr]- Thinking
>
> 先看中间件的执行顺序……

我先追踪一下中间件链。

> [!quote]- Tool Calls · 1 (read)
> **`read`** `{"filePath":"/Users/me/project/src/auth/middleware.ts"}`
>
> > `import { NextResponse } from "next/server"; export function middleware(…) …`

---
```

正文完整渲染 user / assistant 消息（assistant 的 thinking 与每轮工具调用
分别折叠在可折叠的 Obsidian callout 中——`> [!tldr]- Thinking` 和
`> [!quote]- Tool Calls · …`），每个工具调用和结果各压缩成一行摘要，既可读
又能看出 agent 做了什么。之所以用 callout 而不是 HTML `<details>`，是因为
Obsidian 对 HTML 块内嵌 Markdown 的渲染不可靠；在非 Obsidian 环境下 callout
退化为普通引用块。结果与参数预览会包在 inline code 里（分隔符长度会自动
压过内容中的反引号序列），工具的原始输出因此按字面渲染，不会被当作
Markdown 解析。

每个消息块以 setext 一级信息头（`User`、`Assistant`，下一行以 `===` 下划）
开头——高于 AI 内容常见的 `##` 二级标题，解析时也能与内容中的 `#` 一级标题
区分开。信息头的元数据（本地日期时间，assistant 消息还带模型名）放在一个小号
浅色 `<span>` 中（`0.5em`，Obsidian 的 `--text-faint` 颜色），角色名因此保持
醒目，细节又触手可及。每个消息块以"上下各一个空行"包裹的 `---` 分隔线结尾
（多余空行会被裁剪），无论是阅读还是程序化切分，都能清楚地区分每个消息块。
文档标题紧跟在 frontmatter 之后，中间没有空行；追加保存时会顺带修复旧版本
在两者之间写下的空行。

同一个保存文件在 Obsidian 中的两种渲染视图——顶部为
`<标题>-<key>-<时间>.md` 文件名，消息块带角色信息头和时间戳，Thinking
与 Tool Calls 两个 callout 处于折叠状态。首先是 Properties 面板展开、
展示全部 frontmatter 字段的效果：

![保存的对话文件在 Obsidian 中渲染、Properties 面板展开的效果：文件名呈"标题-key-时间"格式，全部 frontmatter 字段以属性形式可见（title、agent、format_version、session_id、cost、tokens、时间戳、project_root、session_file），下方为消息正文开头](https://raw.githubusercontent.com/licongy/pi-claudian/master/packages/auto-save-to-markdown/screenshot-1.png)

然后是 Properties 面板折叠、完整对话正文的效果：

![保存的对话文件在 Obsidian 中的渲染效果：文件名呈"标题-key-时间"格式，frontmatter 折叠在 Properties 面板中，消息块带角色信息头和时间戳，Thinking 与 Tool Calls callout 处于折叠状态](https://raw.githubusercontent.com/licongy/pi-claudian/master/packages/auto-save-to-markdown/screenshot-2.png)

### 碎片化 thinking 修复

部分上游推理流（在 z-ai/GLM 经 OpenRouter 的场景中观察到）会把 thinking
存成一词一行、甚至一字一行：原始空格塌缩成碎片行开头的单个空格，碎片之间
被成串的换行拼接。扩展会检测这种损坏（依据带单个前导空格的行、或大量
1–2 字符碎片行），把碎片重新接回通顺的文本，保存的 thinking 不再一行
一词。段落分隔在修复后得以保留：句末标点之后紧跟 3 个以上换行的分隔串，
在损坏块中约四分之三是真实的段落边界，因此恰好这类分隔被还原成空行段落，
其余全部拼接——断行永远不会插进句子中间，最坏也只是落在两个完整句子
之间，阅读不受影响。正常的 thinking 块原样保存，不做任何改动。

`cost` 和 token 字段统计整条已保存分支，且包含缓存 token（按供应商缓存
价格计费），因此总计可与供应商侧账单（如 OpenRouter Activity）对照。未
进入会话树的请求（失败重试、共用同一 API key 的其他会话）不在其中。

## 分支行为

Pi 会话是树：`/tree` 导航到更早的位置后再提问就分出新的分支。每个
markdown 文件只记录**一个分支**——即该分支看到的 root→leaf 完整路径。

- **同一分支继续对话** → 新消息*追加*到已有文件，frontmatter（`cost`、
  `tokens`、`messages`、`updated`、标题、模型）同步刷新。
- **`/tree` 后重新提问（不同分支）** → _另存新文件_，内容为新分支的完整
  路径（共享前缀 + 新对话）。保存时会以 info 提示分支已切换，指明新文件
  与保留的原分支文件，同一会话的多个文件因此始终可分辨。
- **在当前末端分叉** → 已有文件继续追加（其内容恰好是新分支的精确前缀），
  不会产生重复文件。
- **之后恢复会话**（重启、`/resume`、`/fork`、`/clone`）→ 分支被识别，
  对应文件从上次的位置继续。

分支状态以扩展 custom entry 的形式持久化在会话树内部（不进 LLM 上下文、
不在 TUI 渲染），因此无需任何辅助文件即可在重启和导航后恢复状态。状态发现
直接从磁盘上的 session jsonl（所有运行时共享的追加日志）读取这些条目，因此
即使长驻的暖进程内存视图滞后，也能看到其他运行时记录的保存。

续写目标按最新优先逐个校验：目标文件必须存在、且 frontmatter 的 `messages`
数覆盖当前分支位置（数值更大也没问题——那是子分支沿同一文件继续追加过）。
第一个通过校验的目标即被续写；当最新目标失败而较旧的候选通过时，保存会回退
续写旧文件并发出告警。只有当全部目标失败——文件被删除，或曾被另一个树位置
改写（例如 `/tree` 导航后在旧分支上保存过），继续沿用可能把新分支的消息悄悄
丢掉——才会**以当前分支的完整内容另存新文件**，并在告警中指名失败的目标。
新文件的创建也绝不覆盖已有同名文件（同名回退 `-1`、`-2` … 后缀），两个
运行时同秒并发恢复也不会互相静默覆盖。每个分支因此最终都有一个完整、一致的文件。

被压缩（compaction）过的会话导出的仍是**完整原始历史**——归档永远是全量
对话，而不是压缩后的上下文。

## 调试

```bash
PI_CLAUDIAN_DEBUG=1 pi
```

除显式假值（空串、`0`、`false`、`no`、`off`，忽略大小写）以外的任何值都会开启
调试；取消该变量或将其设为其中某个假值即可关闭。

## 许可

MIT

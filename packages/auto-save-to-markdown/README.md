# @pi-claudian/auto-save-to-markdown

[![npm version](https://img.shields.io/npm/v/@pi-claudian/auto-save-to-markdown?style=flat&colorA=222222&colorB=CB3837)](https://www.npmjs.com/package/@pi-claudian/auto-save-to-markdown)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

[English](README.md) | [中文](README.zh.md)

A [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) extension
that automatically saves every completed conversation turn as a markdown file
with YAML frontmatter — one file per session-tree branch.

## Why

Pi records sessions internally as JSONL trees, which are great for resuming but
terrible for reading, searching, or archiving. This extension mirrors the
conversation into plain markdown files as you work, so every exchange is
preserved in a format any editor, note app, or grep can consume — with the
model, cost, tokens, and session metadata right in the frontmatter.

## Installation

```
pi install npm:@pi-claudian/auto-save-to-markdown
```

## Usage

Automatic: after every settled agent turn (`agent_settled`), the current
conversation branch is written to `<cwd>/<folder>/<title>-<tree>-<time>.md`.

Manual: run `/save-conversation` to save the current branch immediately and
report the file path.

## Configuration

The target folder is controlled by the `PI_SAVE_CONVERSATION_DIR` environment
variable (Pi has no per-extension settings API):

| Value       | Location                            |
| ----------- | ----------------------------------- |
| unset       | `<cwd>/ai-conversations/` (default) |
| `.` or `""` | `<cwd>/` directly                   |
| `notes/ai`  | `<cwd>/notes/ai/`                   |
| `/abs/path` | that absolute path                  |

```bash
PI_SAVE_CONVERSATION_DIR=notes/ai pi
```

## File naming and frontmatter

Filename: `<title>-<tree>-<time>.md`

- `<title>` — the session name (`/name`), or a slug of the first user message
  when the session is unnamed
- `<tree>` — the id of the deepest message entry at file creation (the branch key)
- `<time>` — local file-creation time, `YYYYMMDD-HHmmss`

```markdown
---
title: "Fix login redirect loop"
session_id: "d0a4f541-976d-4d1b-8e1c-30a1f2b3c4d5"
tree: "a1b2c3d4"
model: "claude-sonnet-4-5"
provider: "anthropic"
cost: 0.023401
tokens: 18745
tokens_input: 15230
tokens_output: 3515
messages: 8
created: "2026-08-29T05:05:12.000Z"
updated: "2026-08-29T05:42:10.000Z"
cwd: "/Users/me/project"
session_file: "~/.pi/agent/sessions/--Users-me-project-20260829-050500_ab12.jsonl"
---

# Fix login redirect loop

## User · 13:05:12

The login page redirects in a loop after the auth refactor...

## Assistant · 13:05:40 · claude-sonnet-4-5

<details>
<summary>Thinking</summary>

Let me check the redirect chain...

</details>

I'll trace the middleware order first.

**Tool calls**

- `read` — {"filePath":"/Users/me/project/src/auth/middleware.ts"}

> **Tool · read** /Users/me/project/src/auth/middleware.ts — 120 lines …
```

The body renders user and assistant messages in full (assistant thinking is
kept in a collapsible `<details>` block) and summarizes each tool call and
result in one line, so the file stays readable while still showing what the
agent did.

## Branch behavior

Pi sessions are trees: `/tree` navigates to an earlier point and a new prompt
forks a new branch. Each markdown file records exactly **one branch** — the
root-to-leaf path that branch sees.

- **Same branch, next turn** → new messages are _appended_ to the existing
  file, and the frontmatter (`cost`, `tokens`, `messages`, `updated`, title,
  model) is refreshed.
- **`/tree` + new prompt (a different branch)** → a _new file_ is created
  containing the full new branch (the shared prefix plus the new exchange).
- **Forking at the current tip** → the existing file continues (its content is
  already an exact prefix of the new branch), so no duplicate file is created.
- **Resuming later** (restart, `/resume`, `/fork`, `/clone`) → the branch is
  recognized and its file continues where it left off.

Branch identity is persisted inside the session tree itself via extension
custom entries (never sent to the LLM, not rendered in the TUI), so state
survives restarts and navigation without any sidecar files.

Compacted sessions still export their **full original history** — the archive
always contains the complete conversation, not the compacted context.

## Debug

```bash
PI_CLAUDIAN_DEBUG=1 pi
```

## License

MIT

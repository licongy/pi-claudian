# pi-auto-save-to-markdown

[![npm version](https://img.shields.io/npm/v/pi-auto-save-to-markdown?style=flat&colorA=222222&colorB=CB3837)](https://www.npmjs.com/package/pi-auto-save-to-markdown)
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
pi install npm:pi-auto-save-to-markdown
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

When the session's real name arrives after the file was created (e.g.
Claudian generates its title only after the first reply), the next save
renames the file once to `<name>-<tree>-<original-time>.md` — keeping the
original creation timestamp — and rewrites the frontmatter title and the
document heading to match. The rename happens at most once: later `/name`
changes never touch the filename, and manually renamed files are left alone.

```markdown
---
title: "Fix login redirect loop"
agent: "pi"
session_id: "d0a4f541-976d-4d1b-8e1c-30a1f2b3c4d5"
tree: "a1b2c3d4"
model: "z-ai/glm-5.3"
provider: "openrouter"
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

# Fix login redirect loop

User <span style="font-size: 0.5em; color: var(--text-faint);">2026-08-29 13:05:12</span>
===

The login page redirects in a loop after the auth refactor...

---

Assistant <span style="font-size: 0.5em; color: var(--text-faint);">2026-08-29 13:05:40 · claude-sonnet-4-5</span>
===

> [!tldr]- Thinking
>
> Let me check the redirect chain...

I'll trace the middleware order first.

> [!quote]- Tool Calls · 1 (read)
> **`read`** `{"filePath":"/Users/me/project/src/auth/middleware.ts"}`
>
> > `import { NextResponse } from "next/server"; export function middleware(…) …`

---
```

The body renders user and assistant messages in full (assistant thinking and
per-turn tool calls are each folded into a collapsed Obsidian callout —
`> [!tldr]- Thinking` and `> [!quote]- Tool Calls · …`) and summarizes each
tool call and result in one line, so the file stays readable while still
showing what the agent did. Callouts are used instead of HTML `<details>`
because Obsidian renders markdown inside HTML blocks unreliably; outside
Obsidian the callouts degrade to plain blockquotes. Result and argument
previews are wrapped in inline code spans (with a delimiter sized to survive
backticks inside the content), so raw tool output renders literally instead of
being parsed as markdown.

Each message block opens with a setext level-1 info header (`User`,
`Assistant`) underlined with `===` — one level above the `##` headings AI
content typically starts with, and distinguishable from content `#` headings
when parsing. The header's metadata (local date-time, and the model for
assistant messages) sits in a small faint `<span>` (`0.5em`, Obsidian's
`--text-faint` color), so the role stays visually dominant while the details
remain a glance away. Each block ends with a `---` separator wrapped in single
blank lines (extra blank lines are trimmed), so blocks are easy to tell apart
both when reading and when splitting the file programmatically.

### Fragmented thinking repair

Some upstream reasoning streams (observed with z-ai/GLM via OpenRouter) store
thinking with every word — or every CJK character — on its own line: the
original spaces collapse into leading spaces of one-word fragments joined by
runs of newlines. The extension detects this corruption (lines starting with a
single leading space, or a majority of 1–2-character fragment lines) and
re-joins the fragments into flowing text, so saved thinking reads normally
instead of one word per line. Clean thinking blocks are written untouched.

`cost` and the token fields cover the whole saved branch and include cached
tokens (priced at the provider's cache rates), so the totals are comparable
with provider-side accounting (e.g. OpenRouter activity). Requests that never
landed in the session tree (failed retries, other sessions sharing the same
API key) are necessarily excluded.

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
survives restarts and navigation without any sidecar files. State discovery
reads those entries straight from the session's jsonl on disk — the append
log shared by every runtime — so even a long-lived warm process whose
in-memory tree lags behind still finds saves recorded by other runtimes.

Continuation targets are validated newest-first: the target file must exist
and its frontmatter `messages` count must cover the branch position (a higher
count is fine — a descendant branch extended the same file). The first target
that validates is continued; when the newest one fails but an older candidate
validates, the save downgrades to the older file and warns about it. If every
target fails — the file was deleted, or was rewritten from a different tree
position (e.g. a save on an older branch after `/tree` navigation), where
continuing could silently strand the newer branch's messages — a **fresh file
with the full current branch** is written instead, with a warning naming the
failed target. Every branch therefore always ends up with a complete,
consistent file.

Compacted sessions still export their **full original history** — the archive
always contains the complete conversation, not the compacted context.

## Debug

```bash
PI_CLAUDIAN_DEBUG=1 pi
```

Any value other than an explicit false token (empty, `0`, `false`, `no`, `off` —
case-insensitive) enables it; unset the variable (or set one of those tokens)
to turn it off.

## License

MIT

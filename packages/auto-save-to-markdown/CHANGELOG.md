# pi-auto-save-to-markdown

## 0.5.0

### Minor Changes

- 1c6931f: Read save-state entries straight from the session jsonl on disk instead of the in-memory session tree, falling back to the in-memory scan only when the file is unavailable. A warm process whose in-memory tree lags behind other runtimes (e.g. Pi processes kept alive across an extension upgrade) now still finds states those runtimes recorded, so it continues their file instead of silently rewriting a full copy under a superseded filename — the stale-tree incident's root cause. Parsing is grep-level: the file is read once per save, lines are substring-prefiltered before `JSON.parse`, and corrupt/mid-write lines are skipped.

  Continue-branch resolution now walks a ranked candidate chain: every recorded state whose saved position lies on the current branch is validated newest-first (file exists + frontmatter `messages` count covers the saved position) and the first passing candidate is continued. When the newest candidate fails but an older one validates, the save downgrades to the older file and warns, distinguishing a missing target (external tool moving files) from a count mismatch (concurrent runtime / older extension version) like the recovery warning does; only when every candidate fails is a fresh full file written. This converges repeated recoveries onto existing files instead of minting new ones.

### Patch Changes

- 39b67c1: Fix branch-state tie-breaking so the most recently recorded save wins when several state entries point at the same tree position: after a lost-file recovery this stops re-selecting the dead filename, which caused repeated full rewrites and extra files. Recoveries are no longer silent — when a continuation target is missing on disk or no longer matches the branch's saved messages, a warning names the expected file and the likely cause (an external tool moving files, or a concurrent runtime / older extension version rewriting it). State entries now record a save-state schema version ("MAJOR.MINOR", independent of the package version) and the writer's package version; when a save sees entries from a newer schema — a warm process still running pre-upgrade code after the package was updated — it warns once per session to restart.
- 1c6931f: Rename the package from `auto-save-to-markdown` to `pi-auto-save-to-markdown`, following the Pi community's `pi-` prefix convention for unscoped extension packages. Install with `pi install npm:pi-auto-save-to-markdown`; the previous unscoped name is deprecated.
- 39b67c1: Add an `agent` field to the saved markdown frontmatter identifying the file's generator. This extension only runs inside Pi, so the value is always `"pi"`; the field is reserved so future extensions for other agents can maintain their own value. On appends the field is preserved from the file being continued (creator semantics, like `created`); files written before this change gain the field on their next append.

## 0.4.0

### Minor Changes

- 1311b80: Rename the package from `@pi-claudian/auto-save-to-markdown` to
  `auto-save-to-markdown`: the extension only uses generic Pi session APIs and
  works with any Pi session, not just Claudian collaboration. Install with
  `pi install npm:auto-save-to-markdown`; the old scoped name is deprecated.

  Fix stale frontmatter and lost messages after the target file was deleted or
  rewritten from a different tree position (e.g. a save on an older branch after
  `/tree` navigation): a continuation is now only kept when the file exists and
  its frontmatter `messages` count matches the branch position — otherwise a
  fresh file with the full current branch is written, so no branch's newer
  messages are silently stranded. State selection also now considers every
  recorded save state instead of only the latest per file.

## 0.3.3

### Patch Changes

- 09365be: Change the message info header format in saved conversations: the header is now the bare role (`User` / `Assistant`) followed by the metadata (local date-time `YYYY-MM-DD HH:MM:SS`, plus the model for assistant messages) wrapped in a small faint HTML span (`font-size: 0.5em; color: var(--text-faint)`), instead of the former `User · HH:MM:SS` / `Assistant · HH:MM:SS · model` single line. The timestamp now includes the date, the model joins with `·`, and in Obsidian the metadata renders small and faint so the role stays visually dominant. Appending to files saved by the previous format keeps existing blocks unchanged; only new blocks use the new header.

## 0.3.2

### Patch Changes

- 5668431: Treat explicit false tokens (empty, "0", "false", "no", "off", case-insensitive) as disabling `PI_CLAUDIAN_DEBUG`, instead of enabling it on any non-empty value. Previously `PI_CLAUDIAN_DEBUG=0` turned debug logging on, since environment variables are strings and `"0"` is truthy in JavaScript.

## 0.3.1

### Patch Changes

- 26fc7db: Replace HTML `<details>` folding with Obsidian callout folding in saved conversations: thinking now folds into `> [!tldr]- Thinking` and each assistant block's tool calls into `> [!quote]- Tool Calls · …`. Obsidian renders markdown inside HTML blocks unreliably (unformatted bodies, folding that does not work), while callouts fold and render markdown in both Live Preview and Reading view. Outside Obsidian the callouts degrade to plain blockquotes. Tool result previews (and argument previews) are now wrapped in inline code spans whose delimiter is sized to survive backticks inside the content, so raw tool output renders literally instead of being parsed as markdown.

## 0.3.0

### Minor Changes

- ff204fc: Replace HTML `<details>` folding with Obsidian callout folding in saved conversations: thinking now folds into `> [!tldr]- Thinking` and each assistant block's tool calls into `> [!quote]- Tool Calls · …`. Obsidian renders markdown inside HTML blocks unreliably (unformatted bodies, folding that does not work), while callouts fold and render markdown in both Live Preview and Reading view. Outside Obsidian the callouts degrade to plain blockquotes.

## 0.2.0

### Minor Changes

- cc145d1: Fold tool calls and their results into one collapsible `<details><summary>Tool Calls</summary>` section inside each assistant block. Calls and results live in different session entries (paired by tool call id), so they used to render as a bare call list in the assistant block plus separate one-line result blocks; saves now pair them by id and render each call with its arguments and a result preview (capped at 500 chars, error results marked) in a single collapsible section. A result whose call was saved in an earlier file (mid-turn manual save) still renders as a standalone block, and a call without a result shows a placeholder.

## 0.1.3

### Patch Changes

- d56f59f: Change the saved markdown body format: message info headers (`User · 13:05:12`, `Assistant · 13:05:40 · model`) are now setext level-1 headings underlined with `===` instead of `##` ATX headings — one level above the `##` headings AI content typically starts with, and machine-distinguishable from content `#` headings. Every message block now ends with a `---` separator wrapped in single blank lines (extra blank lines are trimmed), so blocks are easier to scan and to split programmatically. Appending to files saved by the previous format adds a separator at the old/new boundary; existing content is left unchanged.

## 0.1.2

### Patch Changes

- 17ad3f1: Repair newline-fragmented thinking blocks when saving. Some upstream reasoning streams (observed with z-ai/GLM via OpenRouter) store thinking as one word — or one CJK character — per line, with the original spaces surviving only as leading spaces of the fragments; the exported markdown then rendered every token on its own line, which was unreadable and bloated the archive. The extension now detects such blocks (single-leading-space fragment lines, or a majority of 1–2-character fragment lines) and re-joins them into flowing text. Clean thinking blocks are written unchanged.

## 0.1.1

### Patch Changes

- 2a954c9: Fix assistant thinking being rendered after the answer text; thinking now always precedes the text it produced (chronological order).

  Frontmatter: rename `cwd` to `project_root`, and add `tokens_cache_read` / `tokens_cache_write`. `tokens` now counts all billed tokens including cached ones, so totals are comparable with provider-side accounting (e.g. OpenRouter activity).

## 0.1.0

### Minor Changes

- d44ec2d: Initial release. New Pi extension that automatically saves every
  completed conversation turn as a markdown file with YAML frontmatter (title,
  session id, tree/branch key, model, provider, cost, tokens, timestamps).

  One file per session-tree branch: continuing a branch appends new messages,
  `/tree` navigation followed by a new prompt starts a new file with the full
  branch path. Target folder defaults to `ai-conversations/` and can be changed
  via `PI_SAVE_CONVERSATION_DIR` ("." or "" saves directly in the working
  directory). A manual `/save-conversation` command saves on demand.

# pi-auto-save-to-markdown

## 0.8.2

### Patch Changes

- ec116a4: Skip non-persisted sessions in every automatic save: a session Pi does not persist (in-memory SessionManager, `--no-session`) is an ephemeral agent — typically one a host client spawns next to the real conversation (Claudian's title generation, whose one-shot "Generate a title" turns were being archived as junk `User's request …` files) or a one-shot `pi --no-session` run. The `agent_settled` auto-save and the batch command's live save now skip such sessions; the manual `/save-conversation` command still archives one on explicit demand.

## 0.8.1

### Patch Changes

- 8bcc4af: Rework the rendering of injected prompt blocks (editor selections, note references and attachments, loaded skills) in saved conversations:

  - Every injected-block callout is now preset-collapsed with the `-` fold symbol — visible blocks as `> [!quote]-`, the agent-side skill marker as `> [!note]-`. Previously the fold was keyed on content presence, so the note references the client emits as self-closing tags (`<linked_content path="…" />` — no content at all) saved as always-expanded `> [!quote] Linked Content` / `Linked Note` callouts while selections and attachments saved collapsed. Obsidian only offers the fold toggle when there is body to expand, so the symbol is now uniform and free.
  - The skill marker names the loaded skill in its title — `> [!note]- Skill · pi-subagents` — with the location in the body and the content dropped. Which skill was loaded is the marker's whole meaning; with the name hidden in the body, the collapsed marker showed only the meaningless word "Skill".
  - Vault-shaped `path`/`location` attribute values render as bare wikilinks with no `**path**:` label — the aliased filename is self-explanatory (the file is user-provided material), so the label was noise — and lead the attribute line; other attributes keep their `**name**: value` labels.
  - Consecutive visible blocks of the same tag (nothing but whitespace between them) merge into ONE callout: a user attaching five notes saves a single Linked Content callout listing five wikilinks instead of five separate callouts. Skill markers never merge — each names its own skill.

  Document format bumped to 1.5 (parse-invariant rendering changes — folded callouts already existed for contentful blocks).

## 0.8.0

### Minor Changes

- 5bde149: Re-render the prompt blocks the client injects into user messages (editor
  selections, note references and attachments, loaded skills) as generic
  callouts instead of raw XML, which Obsidian cannot render and showed as
  literal angle-bracket text. Known blocks are formatted uniformly — the tag
  name in words as the callout title, attribute pairs as `**name**: value`
  lines (vault-relative note paths become Obsidian wikilinks), quoted content
  in a collapsed callout — while agent-side skill injections collapse to a
  one-line marker with the content dropped. Unknown markup is left verbatim,
  and the fallback filename slug now derives from the typed message with all
  injected blocks stripped.

## 0.7.4

### Patch Changes

- ef3e254: Rename the frontmatter `last_entry_id` field to `branch_last_entry_id` to state its actual scope: the id of the deepest message entry on the saved branch — the last entry of THIS file's branch, not of the whole session tree (a `/tree` switch can leave a newer entry elsewhere in the tree). The value and its update-on-every-append semantics are unchanged; the new name keeps the `_id` suffix convention of `session_id`/`session_key`. Document format bumped to 1.3 (a field rename is a parse-invariant change, not an additive field).
- ef3e254: Write the frontmatter `created` and `updated` timestamps as tz-aware local time: ISO 8601 with the machine's numeric UTC offset (e.g. `2026-08-29T13:05:12+08:00`) instead of UTC `…Z`. The value reads as local wall-clock time without assuming the reader's timezone, matching the local times already shown in the message headers and the filename timestamp. Appends preserve an existing file's original `created` verbatim, so legacy UTC values stay as they are — both spellings are ISO 8601 and parse identically. Document format 1.3 covers this and the `branch_last_entry_id` rename (both ship together, parse-invariant tweaks).

## 0.7.3

### Patch Changes

- 90d69ff: Fix two readability issues in the saved markdown. First, the document heading now sits directly after the frontmatter with no blank line between them (files previously always opened with one extra blank line before the `# title` heading); appends also heal the blank line that older versions wrote into existing files, so active sessions converge on the new layout. Second, the fragmented-thinking repair now preserves paragraph breaks instead of flattening the whole block: a separator run of 3+ newlines that follows a sentence-final character marks a real paragraph break about three times out of four in corrupted blocks (validated against every session of a real project — 70 corrupted blocks), so exactly those separators are restored to blank-line paragraphs while word-separator runs join into flowing text. A break is never inserted mid-sentence; worst case one lands between two complete sentences. Non-whitespace content is preserved byte-for-byte. Document format bumped to 1.2 (both changes are parse-invariant tweaks).

## 0.7.2

### Patch Changes

- bf679a8: Add a rendered-in-Obsidian screenshot to the README (English and Chinese).

## 0.7.1

### Patch Changes

- 5e14679: Rename the frontmatter `tree` field to `session_key`, add `last_entry_id`, and unify the key's format. The old name was ambiguous: in Pi's session jsonl "tree" ids are message entry ids, but the field's value is the filename key, which never matches a jsonl entry id. The renamed `session_key` keeps the file self-describing (frontmatter mirrors the filename key), and the degenerate no-session-id fallback now hashes the deepest message entry's id the same way, so the key is always an opaque 8-hex cluster key, never a raw entry id. The new `last_entry_id` records the id of the deepest message entry on the saved branch at the last write — the file's exact position in the session jsonl tree, updated on every append like `updated`, so the archived markdown anchors to a precise tree location without reading the session jsonl. Internally the save-state field `branchKey` is renamed to `sessionKey` to match (the value is per-session, shared across branches) — save-state schema bumped to 1.2; legacy state entries fail validation and are ignored, so ongoing sessions mint fresh files on their next save. Document format bumped to 1.1 (a field rename is a parse-invariant change, not an additive field).

## 0.7.0

### Minor Changes

- 1263acd: Add `/save-conversation-all`: save every session of the current project in one command. Each session jsonl in the project's sessions folder is rebuilt from disk and saved through the exact same pipeline as the live one — ranked state candidates, the never-overwrite guard, rename-on-title, recovery warnings — with its archive written under that session's own working directory. Idempotent (re-runs continue or report "up to date"), skipping sessions without an assistant reply and pre-tree legacy files, and deferring sessions whose jsonl changes while being processed: the save only proceeds when the file is verified unchanged since it was read (the appended state line is byte-identical to what pi itself writes). The current session saves first through the normal live path; the batch reports a summary with per-session warnings tagged by session id.

### Patch Changes

- 1263acd: Fix rename-on-title's document-heading rewrite: the `# title` line was never actually rewritten, because the heading was located with a pattern anchored at the very first character after the frontmatter, while every file this extension writes has exactly one blank line between the frontmatter and the heading. The heading is now located as the first non-blank line after the frontmatter (a manually deleted heading still leaves the content untouched).

## 0.6.0

### Minor Changes

- 60d2b3a: Rename files to the session's real title once it arrives (rename-on-title). The first save usually happens before a session has its name — Claudian generates the title only after the first reply — so the file is created with a slug of the first user message and the filename never reflected the real title. Once the session name exists, the next save renames the file to `<name>-<key>-<original-timestamp>.md` (keeping the creation timestamp: birthday semantics, and a deterministic target so concurrent or retried renames converge on one name), rewrites the frontmatter title and the document heading to match, and records the new name in the save state. One-way and one-time: a later `/name` change never re-renames, and legacy files (save states predating the `titled` flag) are only renamed when their name segment matches the recomputed fallback slug, so manually organized filenames stay untouched. A rename never overwrites an existing target (`-1`, `-2` … suffixes); a failed rename keeps the old filename and retries on the next save. Save-state schema bumped to 1.1 with the optional `titled` flag; older entries remain readable.
- c5b7e21: Record the document format version in the frontmatter. Every write stamps `format_version: "1.0"` — the version of the format of the LAST write, so an appended file carries the current value even when blocks inside predate it, and "claimed version vs the block formats actually present" can detect mixed-era files. MAJOR bumps mark structural breaks a parser or migration tool must handle (message header structure, `---` separators, callout syntax); MINOR bumps mark parse-invariant tweaks and bugfixes; additive frontmatter fields never bump it. Implemented independently of the planned save-doctor tool: the stamp's value as a migration handle accrues with every file written, so it starts now.
- c5b7e21: Key the archive filename by the session instead of the branch tip. The `<key>` segment of `<title>-<key>-<time>.md` is now the first 8 hex of the SHA-256 of the session id, so every file of one session shares it — a session's files cluster in the archive directory across recoveries and resumes instead of drifting apart (the old key was a snapshot of the branch tip at file creation, which changed on every loss recovery and identified nothing stable). Save-state entries keep the `branchKey` field with this new meaning; existing files are untouched, since state entries address files by their full recorded name.

  Branch switches are now reported too: when `/tree` navigation starts a new branch, the save notifies (info) that a new branch file was created and which earlier branch file is kept on disk, so multiple files of one session stay navigable.

### Patch Changes

- c5b7e21: Never overwrite when creating a fresh archive file. Fresh full saves used the same tmp+rename write as appends, which silently replaces an existing file: two runtimes recovering the same lost file in the same second mint the same filename and overwrite each other without a trace. A fresh save now claims a free filename first, falling back to `-1`, `-2` … suffixes (the same guard rename-on-title already had), and the rename-on-title filename parser tolerates the suffixes so a suffixed file still gets renamed.

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

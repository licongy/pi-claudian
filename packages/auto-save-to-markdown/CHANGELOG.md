# @pi-claudian/auto-save-to-markdown

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

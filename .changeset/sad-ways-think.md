---
"@pi-claudian/auto-save-to-markdown": patch
---

Fix assistant thinking being rendered after the answer text; thinking now always precedes the text it produced (chronological order).

Frontmatter: rename `cwd` to `project_root`, and add `tokens_cache_read` / `tokens_cache_write`. `tokens` now counts all billed tokens including cached ones, so totals are comparable with provider-side accounting (e.g. OpenRouter activity).

---
"@pi-claudian/auto-save-to-markdown": patch
---

Change the saved markdown body format: message info headers (`User · 13:05:12`, `Assistant · 13:05:40 · model`) are now setext level-1 headings underlined with `===` instead of `##` ATX headings — one level above the `##` headings AI content typically starts with, and machine-distinguishable from content `#` headings. Every message block now ends with a `---` separator wrapped in single blank lines (extra blank lines are trimmed), so blocks are easier to scan and to split programmatically. Appending to files saved by the previous format adds a separator at the old/new boundary; existing content is left unchanged.

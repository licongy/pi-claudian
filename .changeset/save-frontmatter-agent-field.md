---
"auto-save-to-markdown": minor
---

Add an `agent` field to the saved markdown frontmatter identifying the file's generator. This extension only runs inside Pi, so the value is always `"pi"`; the field is reserved so future extensions for other agents can maintain their own value. On appends the field is preserved from the file being continued (creator semantics, like `created`); files written before this change gain the field on their next append.

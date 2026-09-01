---
"pi-auto-save-to-markdown": patch
---

Rename the frontmatter `last_entry_id` field to `branch_last_entry_id` to state its actual scope: the id of the deepest message entry on the saved branch — the last entry of THIS file's branch, not of the whole session tree (a `/tree` switch can leave a newer entry elsewhere in the tree). The value and its update-on-every-append semantics are unchanged; the new name keeps the `_id` suffix convention of `session_id`/`session_key`. Document format bumped to 1.3 (a field rename is a parse-invariant change, not an additive field).

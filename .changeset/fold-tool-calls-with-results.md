---
"@pi-claudian/auto-save-to-markdown": minor
---

Fold tool calls and their results into one collapsible `<details><summary>Tool Calls</summary>` section inside each assistant block. Calls and results live in different session entries (paired by tool call id), so they used to render as a bare call list in the assistant block plus separate one-line result blocks; saves now pair them by id and render each call with its arguments and a result preview (capped at 500 chars, error results marked) in a single collapsible section. A result whose call was saved in an earlier file (mid-turn manual save) still renders as a standalone block, and a call without a result shows a placeholder.

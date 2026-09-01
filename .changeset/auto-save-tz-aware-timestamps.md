---
"pi-auto-save-to-markdown": patch
---

Write the frontmatter `created` and `updated` timestamps as tz-aware local time: ISO 8601 with the machine's numeric UTC offset (e.g. `2026-08-29T13:05:12+08:00`) instead of UTC `…Z`. The value reads as local wall-clock time without assuming the reader's timezone, matching the local times already shown in the message headers and the filename timestamp. Appends preserve an existing file's original `created` verbatim, so legacy UTC values stay as they are — both spellings are ISO 8601 and parse identically. Document format 1.3 covers this and the `branch_last_entry_id` rename (both ship together, parse-invariant tweaks).

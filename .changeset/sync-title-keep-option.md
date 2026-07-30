---
"@pi-claudian/sync-title": patch
---

Redesign the interactive title-conflict prompt and add a "keep both" option.

The prompt now shows both conflicting titles up front, instead of burying them
inside each option:

```
Session name conflict detected
Claudian title: "..."
Pi name:        "..."
```

The choices are now "Overwrite Claudian title with Pi name", "Overwrite Pi name
with Claudian title", "Keep both unchanged (no sync)", and "Cancel".

Previously the prompt offered only "overwrite Claudian", "overwrite the Pi name",
or "cancel" — there was no way to keep the two intentionally different without
cancelling. The new "Keep both unchanged (no sync)" option keeps the Pi name and
writes nothing back to Claudian.

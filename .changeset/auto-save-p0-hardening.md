---
"auto-save-to-markdown": patch
---

Fix branch-state tie-breaking so the most recently recorded save wins when several state entries point at the same tree position: after a lost-file recovery this stops re-selecting the dead filename, which caused repeated full rewrites and extra files. Recoveries are no longer silent — when a continuation target is missing on disk or no longer matches the branch's saved messages, a warning names the expected file and the likely cause (an external tool moving files, or a concurrent runtime / older extension version rewriting it). State entries now record a save-state schema version ("MAJOR.MINOR", independent of the package version) and the writer's package version; when a save sees entries from a newer schema — a warm process still running pre-upgrade code after the package was updated — it warns once per session to restart.

---
"pi-auto-save-to-markdown": minor
---

Read save-state entries straight from the session jsonl on disk instead of the in-memory session tree, falling back to the in-memory scan only when the file is unavailable. A warm process whose in-memory tree lags behind other runtimes (e.g. Pi processes kept alive across an extension upgrade) now still finds states those runtimes recorded, so it continues their file instead of silently rewriting a full copy under a superseded filename — the stale-tree incident's root cause. Parsing is grep-level: the file is read once per save, lines are substring-prefiltered before `JSON.parse`, and corrupt/mid-write lines are skipped.

Continue-branch resolution now walks a ranked candidate chain: every recorded state whose saved position lies on the current branch is validated newest-first (file exists + frontmatter `messages` count covers the saved position) and the first passing candidate is continued. When the newest candidate fails but an older one validates, the save downgrades to the older file and warns, distinguishing a missing target (external tool moving files) from a count mismatch (concurrent runtime / older extension version) like the recovery warning does; only when every candidate fails is a fresh full file written. This converges repeated recoveries onto existing files instead of minting new ones.

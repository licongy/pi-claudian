---
"pi-auto-save-to-markdown": minor
---

Add `/save-conversation-all`: save every session of the current project in one command. Each session jsonl in the project's sessions folder is rebuilt from disk and saved through the exact same pipeline as the live one — ranked state candidates, the never-overwrite guard, rename-on-title, recovery warnings — with its archive written under that session's own working directory. Idempotent (re-runs continue or report "up to date"), skipping sessions without an assistant reply and pre-tree legacy files, and deferring sessions whose jsonl changes while being processed: the save only proceeds when the file is verified unchanged since it was read (the appended state line is byte-identical to what pi itself writes). The current session saves first through the normal live path; the batch reports a summary with per-session warnings tagged by session id.

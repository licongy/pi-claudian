---
"@pi-claudian/sync-title": patch
---

Cancel pending title-sync retry timers on `session_shutdown` and drop them quietly when their captured ctx went stale, instead of logging `retry #N failed: This extension ctx is stale after session replacement or reload`. The error appeared whenever a session was replaced (/new, fork, /resume — including Claudian conversation switches) or reloaded while a backoff retry was still queued; the replacement session re-arms the sync via its own `session_start`, so the stale retry is safely discarded.

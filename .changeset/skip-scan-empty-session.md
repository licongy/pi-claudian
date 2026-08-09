---
"@pi-claudian/sync-title": patch
---

Skip Claudian meta directory scans for sessions with no conversation content

Claudian links the Pi sessionId into its `.meta.json` only after the first turn
completes, so a session with no message entries cannot have a matching meta yet.
The `session_start` retry path now skips the directory scan entirely when there
are no messages, and cancels retries once the first retry confirms there is
still no conversation. This eliminates up to 6 wasteful directory scans (~2
minutes of retries) for every plain `pi` session started inside a Claudian
vault.

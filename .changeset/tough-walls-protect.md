---
"@pi-claudian/sync-session": patch
---

`/sync-session`, `/tree`, and `/fork` now also write the conversation's
top-level `sessionId` (not only `providerState`) to the Claudian meta file.

Claudian's `resolveMissingConversationSession` detaches a session it deems
missing: when neither a top-level nor `providerState` `sessionId` is present it
drops `leafEntryId` as well, which makes the conversation unresumable. Writing
the Pi session id in both places preserves `leafEntryId` through such a false
alarm. Also fixes `/sync-session` reporting "already in sync" when only the
top-level `sessionId` was missing — it now backfills it instead of skipping.

The backfill now also runs **automatically on session resume** (`session_start`
reason `"resume"`), so existing conversations heal themselves the first time
they are reopened in Claudian — no manual `/sync-session` needed. The resume
sync is silent unless a meta was actually patched.

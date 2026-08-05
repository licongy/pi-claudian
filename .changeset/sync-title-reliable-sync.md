---
"@pi-claudian/sync-title": patch
---

Fix titles rarely syncing for Claudian-driven sessions. Claudian links the Pi
session id into its conversation meta and generates the title asynchronously
_after_ the first turn completes, so the previous single one-shot 10s retry at
`agent_end` almost always raced and lost (the meta wasn't matched or the title
was still `pending`), leaving the Pi session name empty.

- Add a `session_start` reconcile: this is the primary reliable sync moment,
  because when a conversation is resumed Claudian has already persisted its meta
  (sessionId + title), so the title is pulled into the Pi session name
  immediately.
- Replace the one-shot retry with a renewing backoff (≈10s → 45s, ~2 min total)
  that outlasts Claudian's async title generation within a live session.
- Retry while no meta matches yet, but only from `session_start` (once per
  launch), so plain `pi` sessions run inside a Claudian vault are not spun on
  every turn.

Multi-turn conversations now sync during the session; single-turn conversations
sync on the next open. Fully reliable first-open syncing of a brand-new
conversation additionally requires Claudian to call Pi's `set_session_name` when
its title generation completes (tracked separately on the Claudian side).

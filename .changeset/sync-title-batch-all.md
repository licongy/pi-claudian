---
"@pi-claudian/sync-title": minor
---

Add `/sync-title-all` to batch-sync every Claudian conversation in the current
vault at once.

The existing per-session sync only fires when a conversation is opened/resumed
(`session_start`) or after each turn (`agent_end`). Conversations that ended
after a single turn and were never resumed therefore keep an empty Pi session
name: Claudian's title lands asynchronously after the first reply, but by then
the process has exited and the retry budget is gone.

`/sync-title-all` scans every `conv-*.meta.json` in the vault and applies the
same decision table to each, non-interactively: it fills empty names in both
directions (Claudian → Pi, Pi → Claudian) and skips conflicts without
overwriting (reporting them so each can be resolved with `/sync-title`).

- The current session is synced through the live `pi.setSessionName()` API so
  Pi's in-memory state stays consistent.
- Every other session is synced by appending a `session_info` entry directly to
  its jsonl (mirroring Pi's own `appendSessionInfo()`: sanitized name, unique
  id, `parentId` = current tree leaf), which Pi picks up on the next resume.
- A plan is summarized and confirmed before any files are written.

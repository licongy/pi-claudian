---
"@pi-claudian/sync-session": patch
---

Show operation results in the pi TUI as a multi-line summary instead of terse
one-line status text, and make them actually visible after `/tree` and `/fork`.

Every `/tree`, `/fork`/`/clone`, and manual `/sync-session` now reports the
session(s) affected, e.g.:

```
[Session Sync] Synced 1 session to Claudian:
  • 019face1-5126-… (session name)
      leaf 34c9f9bb → 9030697f
```

Automatic triggers (`/tree`, `/fork`/`/clone`) show the summary in an
auto-clearing widget, because pi replaces the last chat status line (and re-renders
the chat on `/tree`) right after these events — a plain `notify` was overwritten
before it could be read. Manual `/sync-session` has no such follow-up and uses a
persistent status line. No-op / not-a-Claudian-session / error cases also surface
a notification so no operation is silent.

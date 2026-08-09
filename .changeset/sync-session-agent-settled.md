---
"@pi-claudian/sync-session": minor
---

Auto-sync leaf after every turn (`agent_settled`), fix stale-cache race
condition, and bump `lastActivityAt`.

- **New: `agent_settled` auto-sync.** After `/tree` navigation + re-ask, the
  `session_tree` event only wrote the *navigated-to* leaf (the parent of the old
  user message), not the new entries created by the re-ask. The meta stayed stale
  until the user manually ran `/sync-session`. Now `agent_settled` fires after
  every fully-completed turn and re-syncs the current leaf automatically — no
  manual intervention needed. Silent when the leaf is already in sync; transient
  widget only when a meta was actually written.

- **Fix: `patchMeta` read-modify-write race.** `patchMeta` previously used the
  stale meta snapshot from the initial `findMeta` scan and overwrote the entire
  file. If Claudian wrote to the meta between the scan and the write, those
  changes (e.g. `lastActivityAt`, `usage`) were lost. Now `patchMeta` re-reads
  the file right before writing, preserving Claudian's concurrent changes —
  only the explicit sync fields are overlaid.

- **Fix: `lastActivityAt` not bumped.** Claudian never watches Pi for changes;
  it relies on `lastActivityAt` to detect conversation updates and invalidate its
  display cache. sync-session updated `leafEntryId` and `updatedAt` but never
  touched `lastActivityAt`, so Claudian kept showing the pre-`/tree` content even
  though `leafEntryId` was correct. Every sync that actually writes a new leaf
  now also bumps `lastActivityAt` to `Date.now()`.

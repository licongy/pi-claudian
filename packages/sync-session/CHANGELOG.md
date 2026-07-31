# @pi-claudian/sync-session

## 0.1.0

### Minor Changes

- Add `@pi-claudian/sync-session`, a pi extension that syncs pi session-tree
  changes into Claudian's conversation metadata (`.claudian/sessions`).

  - `/tree` (and tree keybindings): writes the new active leaf into the matching
    conversation's `providerState.leafEntryId`, so Claudian resumes on the correct
    branch instead of the stale one.
  - `/fork` & `/clone`: creates a new `conv-*.meta.json` for the forked session,
    copying the source title/model and pointing at the new sessionFile/sessionId/
    leafEntryId, so the fork appears in Claudian's conversation list.
  - Idempotent fork creation (reconciles the leaf if Claudian already has a
    conversation for the forked session), pi-provider only, atomic writes, and a
    silent no-op outside Claudian-managed vaults.
  - Adds a `/sync-session` command for on-demand leaf re-sync.

  Claudian → pi fork conversion is intentionally not handled here (Claudian owns
  the pi-session lifecycle for its own conversations).

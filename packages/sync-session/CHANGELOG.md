# @pi-claudian/sync-session

## 0.1.3

### Patch Changes

- f29edd2: Add Simplified Chinese README (`README.zh.md`) with language-switch links between the English and Chinese READMEs, and include `README.zh.md` in the published `files` so it ships to npm.

## 0.1.2

### Patch Changes

- 9c84fe6: Update description and keywords for clone support.

## 0.1.1

### Patch Changes

- 2841d6d: Show operation results in the pi TUI as a multi-line summary instead of terse
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

# @pi-claudian/sync-title

## 0.2.0

### Minor Changes

- 42f8da6: Add `/sync-title-all` to batch-sync every Claudian conversation in the current
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

## 0.1.8

### Patch Changes

- 1fc9c82: Fix titles rarely syncing for Claudian-driven sessions. Claudian links the Pi
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

## 0.1.7

### Patch Changes

- 43bdaa2: Resolve the Claudian sessions directory from the session's home (`ctx.cwd`)
  instead of `process.cwd()`, walking upward to the nearest `.claudian/sessions`.
  This fixes title sync being silently skipped when a Claudian session is resumed
  from a sub-directory of the vault. The sessionFile fallback match now uses
  `fs.realpath` so symlinked vaults compare equal.

## 0.1.6

### Patch Changes

- f35b29a: Add Simplified Chinese README (`README.zh.md`) with language-switch links between the English and Chinese READMEs, and include `README.zh.md` in the published `files` so it ships to npm.

## 0.1.5

### Patch Changes

- Improve npm discoverability with higher-signal keywords (pi-coding-agent, pi-claudian, conversation-title, session-name, two-way-sync, title-sync); drop generic terms (sync, title, session, extension). Keep pi-package and pi-extension required by the pi.dev gallery.

## 0.1.4

### Patch Changes

- 9502394: Redesign the interactive title-conflict prompt and add a "keep both" option.

  The prompt now shows both conflicting titles up front, instead of burying them
  inside each option:

  ```
  Session name conflict detected
  Claudian title: "..."
  Pi name:        "..."
  ```

  The choices are now "Overwrite Claudian title with Pi name", "Overwrite Pi name
  with Claudian title", "Keep both unchanged (no sync)", and "Cancel".

  Previously the prompt offered only "overwrite Claudian", "overwrite the Pi name",
  or "cancel" — there was no way to keep the two intentionally different without
  cancelling. The new "Keep both unchanged (no sync)" option keeps the Pi name and
  writes nothing back to Claudian.

## 0.1.3

### Patch Changes

- Correctly implement title sync as two-way and conflict-safe.

  Previously the extension only synced Claudian → Pi and would silently overwrite a
  session the user had named themselves. It now syncs in both directions using a
  single decision table:

  - Pi name empty + Claudian title ready → Claudian → Pi (unchanged).
  - Pi name set + Claudian title empty → Pi → Claudian (new), unless Claudian is
    still generating its title (`titleGenerationStatus === "pending"`), in which
    case it notifies and waits instead of racing the generator.
  - Both set and equal → no-op.
  - Both set and different:
    - Automatic triggers (after a reply) now only notify and keep the Pi name,
      instead of overwriting it.
    - Interactive triggers (`/name`, `/sync-title`) prompt the user to choose
      pi→Claudian, Claudian→pi, or cancel.
  - Clearing the Pi name no longer erases the Claudian title.

  Implementation notes: writes back to Claudian are atomic (tmp + rename); a
  self-write guard prevents `setSessionName` from re-entering the decision table;
  the `/sync-title` command description is updated.

## 0.1.2

### Patch Changes

- Switch to source-first publishing (Pi loads `index.ts` via jiti, no `dist/`) and add the shared `PI_CLAUDIAN_DEBUG` env var for stderr debug tracing.

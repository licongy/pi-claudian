# @pi-claudian/sync-title

## 0.3.1

### Patch Changes

- ec116a4: Scan Claudian 2.2.5+'s per-device metadata layout: conversation metas created by Claudian 2.2.5 live in `.claudian/sessions/devices/<deviceId>/conv-*.meta.json` instead of the sessions dir's top level where all earlier versions (and 2.2.5+ itself for pre-existing conversations) write them. Both extensions now scan both locations — top level first, then every device subdirectory — so title sync and session-tree sync keep working for conversations created under the new layout. sync-title's pending-title watcher now watches the matched meta's own directory (the sessions root, or its `devices/<deviceId>/` subdirectory), so Claudian writing a device-scoped meta is still caught within milliseconds.

## 0.3.0

### Minor Changes

- 5f1ce8d: Establish 0.3.0 as the new supported baseline. All versions below 0.3.0 will be deprecated on the npm registry.

## 0.2.4

### Patch Changes

- 39b67c1: Fix three timing gaps that delayed or dropped title sync for new Claudian conversations. The association-wait retry chain no longer dies permanently when the first message has not been sent within 10s (its early attempts scan before any content exists — slow starters survive); agent_end now retries with a short bounded chain while no meta matches yet (previously zero retries deferred the sync to the next turn), at most once per session so plain `pi` sessions are not re-polled every turn; and while a matched conversation's title is still being generated, a directory watcher on `.claudian/sessions` picks up Claudian's title write within milliseconds (the backoff retries remain as a backstop), instead of waiting for the next backoff tick.

## 0.2.3

### Patch Changes

- 5668431: Treat explicit false tokens (empty, "0", "false", "no", "off", case-insensitive) as disabling `PI_CLAUDIAN_DEBUG`, instead of enabling it on any non-empty value. Previously `PI_CLAUDIAN_DEBUG=0` turned debug logging on, since environment variables are strings and `"0"` is truthy in JavaScript.

## 0.2.2

### Patch Changes

- 17ad3f1: Cancel pending title-sync retry timers on `session_shutdown` and drop them quietly when their captured ctx went stale, instead of logging `retry #N failed: This extension ctx is stale after session replacement or reload`. The error appeared whenever a session was replaced (/new, fork, /resume — including Claudian conversation switches) or reloaded while a backoff retry was still queued; the replacement session re-arms the sync via its own `session_start`, so the stale retry is safely discarded.

## 0.2.1

### Patch Changes

- 4843a32: Skip Claudian meta directory scans for sessions with no conversation content

  Claudian links the Pi sessionId into its `.meta.json` only after the first turn
  completes, so a session with no message entries cannot have a matching meta yet.
  The `session_start` retry path now skips the directory scan entirely when there
  are no messages, and cancels retries once the first retry confirms there is
  still no conversation. This eliminates up to 6 wasteful directory scans (~2
  minutes of retries) for every plain `pi` session started inside a Claudian
  vault.

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

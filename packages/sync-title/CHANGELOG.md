# @pi-claudian/sync-title

## 0.1.3

### Patch Changes

- Correctly implement title sync as two-way and conflict-safe.

  Previously the extension only synced Claudian → pi and would silently overwrite a
  session the user had named themselves. It now syncs in both directions using a
  single decision table:

  - pi name empty + Claudian title ready → Claudian → pi (unchanged).
  - pi name set + Claudian title empty → pi → Claudian (new), unless Claudian is
    still generating its title (`titleGenerationStatus === "pending"`), in which
    case it notifies and waits instead of racing the generator.
  - Both set and equal → no-op.
  - Both set and different:
    - Automatic triggers (after a reply) now only notify and keep the pi name,
      instead of overwriting it.
    - Interactive triggers (`/name`, `/sync-title`) prompt the user to choose
      pi→Claudian, Claudian→pi, or cancel.
  - Clearing the pi name no longer erases the Claudian title.

  Implementation notes: writes back to Claudian are atomic (tmp + rename); a
  self-write guard prevents `setSessionName` from re-entering the decision table;
  the `/sync-title` command description is updated.

## 0.1.2

### Patch Changes

- Switch to source-first publishing (pi loads `index.ts` via jiti, no `dist/`) and add the shared `PI_CLAUDIAN_DEBUG` env var for stderr debug tracing.

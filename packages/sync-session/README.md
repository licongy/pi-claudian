# @pi-claudian/sync-session

[![npm version](https://img.shields.io/npm/v/@pi-claudian/sync-session?style=flat&colorA=222222&colorB=CB3837)](https://www.npmjs.com/package/@pi-claudian/sync-session)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

[English](README.md) | [中文](README.zh.md)

A [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) extension
that bridges [Claudian](https://github.com/claudian) and Pi: it syncs Pi
session-tree changes (`/tree`, `/fork`, `/clone`) into Claudian's conversation
metadata, so Claudian's view of a conversation stays correct after you branch or
fork from inside Pi.

## Why

Claudian stores per-conversation metadata under `.claudian/sessions/conv-*.meta.json`.
For Pi-provider conversations it tracks the active position in Pi's session tree
as `providerState.leafEntryId`, plus the `sessionFile` and `sessionId`. Claudian
never watches Pi for changes, so two Pi operations leave that metadata stale:

- **`/tree`** moves the active leaf to an earlier entry **within the same session
  file** (optionally appending a branch summary). Claudian still points at the old
  leaf, so resuming the conversation in Claudian opens the wrong branch.
- **`/fork` / `/clone`** create a **new session file and UUID**. Claudian has no
  conversation for the new session, so it never appears in Claudian's list.

This extension closes that gap in the Pi → Claudian direction.

### Protecting conversations from Claudian's missing-session cleanup

Claudian's `resolveMissingConversationSession` detaches a Pi session it deems
"missing": when it does, and neither a top-level nor `providerState` `sessionId`
is present, it also drops `leafEntryId` — which makes the conversation
**unresumable** (it vanishes from Claudian's list). This has caused real data
loss when Claudian false-alarms on session availability (e.g. after a version
upgrade).

This extension is the safety net: every sync — automatic or manual — also
writes the Pi session id into the conversation's **top-level `sessionId`**
(not only `providerState`). With the id present in both places, the cleanup
keeps `leafEntryId` and the conversation stays resumable. The backfill runs
**automatically on every session resume**, so existing conversations heal
themselves the first time you reopen them in Claudian.

## Installation

```
pi install npm:@pi-claudian/sync-session
```

## Usage

Automatic:

- After **`/tree`** (or tree navigation via keybinding), the new leaf id is
  written into the matching Claudian conversation's `providerState.leafEntryId`.
- After **`/fork`** / **`/clone`**, a new `conv-*.meta.json` is created for the
  forked session, copying the source title/model and pointing at the new
  `sessionFile` / `sessionId` / `leafEntryId`. The fork then shows up in
  Claudian's conversation list.
- On **session resume** (Claudian opening an existing conversation), the
  conversation's top-level `sessionId` is auto-backfilled if missing — silently,
  unless a patch was actually applied.

Manual: run **`/sync-session`** to re-sync the current leaf on demand.

**The sync summary** — after `/tree`, `/fork`, or `/sync-session` the result is
shown as a multi-line list of the session(s) affected (here a `/sync-session`
that was already in sync). No operation is silent:

![Pi TUI showing the sync-session command and a multi-line summary listing the synced session with its id and name](https://raw.githubusercontent.com/licongy/pi-claudian/master/packages/sync-session/screenshot.png)

## Behavior

- Matches the Claudian meta file by Pi session id first, falling back to the
  `providerState.sessionFile` path (compared through `fs.realpath`, so symlinked
  vaults match).
- In addition to `providerState`, every sync also (re)writes the conversation's
  top-level `sessionId` to the Pi session id. Claudian's
  `resolveMissingConversationSession` detaches a session it deems missing: when
  neither a top-level nor `providerState` `sessionId` is present, it also drops
  `leafEntryId`, which makes the conversation unresumable. Keeping the Pi
  session id in both places is the safety net that preserves `leafEntryId`
  through such a false alarm. This mirrors what fork creation already writes.
- **Vault resolution** uses the session's own home directory (`ctx.cwd`, which
  Pi sets to the resumed session's recorded `cwd` — not `process.cwd()`),
  walking upward to the nearest `.claudian/sessions`. So resuming a Claudian
  session from a sub-directory of the vault still syncs correctly.
- Fork conversations inherit the source title so they are identifiable
  immediately; `@pi-claudian/sync-title` reconciles the Pi name on the next turn.
- Fork creation is idempotent: if a Claudian conversation already exists for the
  forked session (e.g. Claudian's own fork conversion already ran), the leaf is
  reconciled instead of duplicating the conversation.
- Only `pi`-provider conversations are touched; other providers are left alone.
- Writes to Claudian are atomic (tmp file + rename) so Claudian never reads a
  half-written meta file.
- Silent no-op outside of a Claudian-managed vault (e.g. plain TUI sessions).

### Claudian → Pi (fork conversion)

This extension does not sync Claudian-side forks back into Pi — there is no
need. When Claudian forks a Pi-based conversation it already creates the Pi
session file (and the matching `.claudian/sessions` conversation), so the Pi
side is already up to date after a Claudian fork.

For background: Claudian owns the Pi-session lifecycle for its own conversations
and performs fork conversion in its own process, where a session-scoped Pi
extension cannot reliably observe it. This extension therefore focuses on the
opposite direction (Pi → Claudian), which Claudian does not do itself.

## Debug

Trace matching and writes by enabling the shared `@pi-claudian` debug switch
(output goes to stderr):

```sh
PI_CLAUDIAN_DEBUG=1 pi              # show debug output inline
PI_CLAUDIAN_DEBUG=1 pi 2>debug.log  # capture to a file
```

Look for `[pi-claudian]`-tagged lines such as `synced leaf:` or
`created fork conversation:`.

## License

MIT

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

Manual: run **`/sync-session`** to re-sync the current leaf on demand.

**The sync summary** — after `/tree`, `/fork`, or `/sync-session` the result is
shown as a multi-line list of the session(s) affected (here a `/sync-session`
that was already in sync). No operation is silent:

![Pi TUI showing the sync-session command and a multi-line summary listing the synced session with its id and name](https://raw.githubusercontent.com/licongy/pi-claudian/master/packages/sync-session/screenshot.png)

## Behavior

- Matches the Claudian meta file by Pi session id first, falling back to the
  `providerState.sessionFile` path.
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

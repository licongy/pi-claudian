# @pi-claudian/sync-title

[![npm version](https://img.shields.io/npm/v/@pi-claudian/sync-title?style=flat&colorA=222222&colorB=CB3837)](https://www.npmjs.com/package/@pi-claudian/sync-title)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

[English](README.md) | [中文](README.zh.md)

A [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) extension
that bridges [Claudian](https://github.com/claudian) and Pi: it does a two-way
sync of the Claudian conversation title with the Pi session name, so the two
stay in sync whether the title comes from Claudian's auto-generation or from a
Pi `/name` command.

## Why

Claudian stores per-conversation metadata under `.claudian/sessions/` — at the
top level (`conv-*.meta.json`) for conversations created before Claudian 2.2.5,
and in per-device subdirectories (`devices/<deviceId>/conv-*.meta.json`) for
newer ones (including an auto-generated `title`) — but never tells Pi about it,
and Pi's `/name` command never tells Claudian. This extension closes that gap in
both directions, with conflict resolution that never silently overwrites a name
you set yourself. Both storage layouts are always scanned.

## Installation

```
pi install npm:@pi-claudian/sync-title
```

## Usage

Automatic: titles are reconciled when a conversation is opened/resumed and after
each agent turn. No action required.

Manual: run the `/sync-title` command to reconcile the current session on
demand (it prompts on conflict and retries while Claudian's title is still
being generated).

Batch: run `/sync-title-all` to reconcile **every** Claudian conversation in
the current vault at once. This is the fix for conversations that ended after a
single turn and were never resumed — their Pi session name stays empty because
the per-session sync only fires on open/turn. It is non-destructive: it fills
empty names in both directions (Claudian → Pi, Pi → Claudian) and **skips
conflicts without overwriting**, reporting them so each can be resolved with
`/sync-title`. The current session is synced live; others are synced by
appending a `session_info` entry to their jsonl, which Pi picks up on the next
resume. A plan is shown for confirmation before any files are written.

## Behavior

The extension resolves the Pi session name against the Claudian title using a
single decision table:

| Pi name | Claudian title                            | Action                                                     |
| ------- | ----------------------------------------- | ---------------------------------------------------------- |
| empty   | empty                                     | wait and retry (title not ready yet)                       |
| empty   | ready                                     | Claudian → Pi                                              |
| ready   | empty                                     | Pi → Claudian (skipped while Claudian is still generating) |
| ready   | same                                      | no-op                                                      |
| ready   | different (automatic)                     | notify only, keep Pi name                                  |
| ready   | different (manual `/name`, `/sync-title`) | prompt: Pi→Claudian / Claudian→Pi / keep both / cancel     |

Notes:

- **Sync triggers:** when a conversation is opened or resumed (the primary
  sync moment — Claudian has already persisted its meta, so the title is pulled
  in immediately) and after each agent turn.
- Claudian generates the conversation title asynchronously _after_ the first
  turn and only then links the Pi session id into its meta. Both waits are
  handled by phase: the **association wait** (no meta matched yet) is strictly
  bounded polling — session_start arms a short retry chain whose early
  attempts also scan before the first message exists, so a slow-to-start
  conversation is not abandoned; agent_end arms the same chain at most once per
  session (after it runs out the session is latched as non-Claudian, so plain
  `pi` sessions are not re-polled every turn). The **title wait** (meta matched,
  title still pending) keeps the backoff retries (~2 minutes total) as a
  backstop and additionally watches the matched meta's own directory (the
  sessions root, or its `devices/<deviceId>/` subdirectory for the newer
  per-device layout): when Claudian writes the generated title, a debounced
  reconcile runs within milliseconds and the watcher is torn down once the
  sync settles.
- Matches the Claudian meta file by Pi session UUID first, falling back to the
  `providerState.sessionFile` path (compared through `fs.realpath`, so symlinked
  vaults match).
- **Vault resolution** uses the session's own home directory (`ctx.cwd`, which
  Pi sets to the resumed session's recorded `cwd` — not `process.cwd()`),
  walking upward to the nearest `.claudian/sessions`. So resuming a Claudian
  session from a sub-directory of the vault still syncs correctly.
- Never silently overwrites a session you named yourself: automatic triggers
  (after a reply) only notify on a mismatch; interactive triggers let you choose
  to sync Pi→Claudian, Claudian→Pi, keep both unchanged, or cancel.
- Clears: clearing the Pi name with `/name` (empty) does **not** erase the
  Claudian title.
- Silent no-op outside of a Claudian-managed vault (e.g. plain TUI sessions).
  Plain `pi` sessions run _inside_ a Claudian vault are also left alone: the
  association-wait retry chain runs at most once per session and is then
  latched, so there is no per-turn retry noise.
- While Claudian's title status is `pending`, the extension waits rather than
  writing back a Pi name that would race the generator.
- Writes back to Claudian are atomic (tmp file + rename) so Claudian never reads
  a half-written meta file.

**The interactive conflict prompt** — shown on `/name` or `/sync-title` when the
two titles differ. Claudian is never overwritten without your say:

![Interactive conflict-resolution prompt: sync Pi → Claudian, Claudian → Pi, keep both, or cancel](https://raw.githubusercontent.com/licongy/pi-claudian/master/packages/sync-title/screenshot.png)

## Debug

Trace matching, retries, and writes by enabling the shared `@pi-claudian` debug
switch (output goes to stderr):

```sh
PI_CLAUDIAN_DEBUG=1 pi              # show debug output inline
PI_CLAUDIAN_DEBUG=1 pi 2>debug.log  # capture to a file
```

Any value other than an explicit false token (empty, `0`, `false`, `no`, `off` —
case-insensitive) enables it; unset the variable (or set one of those tokens)
to turn it off.

Look for `[pi-claudian]`-tagged lines such as `writing session name from Claudian`
or `conflict — prompting user`.

## License

MIT

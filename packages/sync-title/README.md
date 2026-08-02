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

Claudian stores per-conversation metadata under `.claudian/sessions/conv-*.meta.json`
(including an auto-generated `title`) but never tells Pi about it, and Pi's
`/name` command never tells Claudian. This extension closes that gap in both
directions, with conflict resolution that never silently overwrites a name you
set yourself.

## Installation

```
pi install npm:@pi-claudian/sync-title
```

## Usage

Automatic: after each agent turn the two titles are reconciled. No action required.

Manual: run the `/sync-title` command to reconcile on demand (it will schedule a
retry if Claudian has not generated its title yet, and will prompt on conflict).

## Behavior

The extension resolves the Pi session name against the Claudian title using a
single decision table:

| Pi name | Claudian title                            | Action                                                     |
| ------- | ----------------------------------------- | ---------------------------------------------------------- |
| empty   | empty                                     | nothing (auto-retry if Claudian is still generating)       |
| empty   | ready                                     | Claudian → Pi                                              |
| ready   | empty                                     | Pi → Claudian (skipped while Claudian is still generating) |
| ready   | same                                      | no-op                                                      |
| ready   | different (automatic)                     | notify only, keep Pi name                                  |
| ready   | different (manual `/name`, `/sync-title`) | prompt: Pi→Claudian / Claudian→Pi / keep both / cancel     |

Notes:

- Matches the Claudian meta file by Pi session UUID first, falling back to the
  `providerState.sessionFile` path (compared through `fs.realpath`, so symlinked
  vaults match).
- **Vault resolution** uses the session's own home directory (`ctx.cwd`, which
  pi sets to the resumed session's recorded `cwd` — not `process.cwd()`),
  walking upward to the nearest `.claudian/sessions`. So resuming a Claudian
  session from a sub-directory of the vault still syncs correctly.
- Never silently overwrites a session you named yourself: automatic triggers
  (after a reply) only notify on a mismatch; interactive triggers let you choose
  to sync Pi→Claudian, Claudian→Pi, keep both unchanged, or cancel.
- Clears: clearing the Pi name with `/name` (empty) does **not** erase the
  Claudian title.
- Silent no-op outside of a Claudian-managed vault (e.g. plain TUI sessions).
- Claudian title generation is asynchronous; while its status is `pending`, the
  extension waits rather than writing back a Pi name that would race the
  generator.
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

Look for `[pi-claudian]`-tagged lines such as `writing session name from Claudian`
or `conflict — prompting user`.

## License

MIT

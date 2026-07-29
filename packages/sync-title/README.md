# @pi-claudian/sync-title

A [pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) extension
that bridges [Claudian](https://github.com/claudian) and pi: it does a two-way
sync of the Claudian conversation title with the pi session name, so the two
stay in sync whether the title comes from Claudian's auto-generation or from a
pi `/name` command.

## Why

Claudian stores per-conversation metadata under `.claudian/sessions/conv-*.meta.json`
(including an auto-generated `title`) but never tells pi about it, and pi's
`/name` command never tells Claudian. This extension closes that gap in both
directions, with conflict resolution that never silently overwrites a name you
set yourself.

## Install

```
pi install npm:@pi-claudian/sync-title
```

## Usage

Automatic: after each agent turn the two titles are reconciled. No action required.

Manual: run the `/sync-title` command to reconcile on demand (it will schedule a
retry if Claudian has not generated its title yet, and will prompt on conflict).

## Behavior

The extension resolves the pi session name against the Claudian title using a
single decision table:

| pi name | Claudian title                            | Action                                                     |
| ------- | ----------------------------------------- | ---------------------------------------------------------- |
| empty   | empty                                     | nothing (auto-retry if Claudian is still generating)       |
| empty   | ready                                     | Claudian → pi                                              |
| ready   | empty                                     | pi → Claudian (skipped while Claudian is still generating) |
| ready   | same                                      | no-op                                                      |
| ready   | different (automatic)                     | notify only, keep pi name                                  |
| ready   | different (manual `/name`, `/sync-title`) | prompt: pi→Claudian / Claudian→pi / cancel                 |

Notes:

- Matches the Claudian meta file by pi session UUID first, falling back to the
  `providerState.sessionFile` path.
- Never silently overwrites a session you named yourself: automatic triggers
  (after a reply) only notify on a mismatch; interactive triggers let you choose.
- Clears: clearing the pi name with `/name` (empty) does **not** erase the
  Claudian title.
- Silent no-op outside of a Claudian-managed vault (e.g. plain TUI sessions).
- Claudian title generation is asynchronous; while its status is `pending`, the
  extension waits rather than writing back a pi name that would race the
  generator.
- Writes back to Claudian are atomic (tmp file + rename) so Claudian never reads
  a half-written meta file.

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

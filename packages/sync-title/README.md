# @pi-claudian/sync-title

A [pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) extension
that bridges [Claudian](https://github.com/claudian) and pi: it reads the
conversation title Claudian auto-generates and writes it into the pi session
name, so the title shows up in pi's `/resume` list.

## Why

Claudian stores per-conversation metadata under `.claudian/sessions/conv-*.meta.json`
(including an auto-generated `title`) but never tells pi about it. This extension
syncs that title into pi's session name on every `agent_end`, with a single
delayed retry to cover Claudian's async title-generation latency.

## Install

```
pi install npm:@pi-claudian/sync-title
```

## Usage

Automatic: the title is synced after each agent turn. No action required.

Manual: run the `/sync-title` command to sync on demand (it will schedule a
retry if Claudian has not generated the title yet).

## Behavior

- Matches the Claudian meta file by pi session UUID first, falling back to the
  `providerState.sessionFile` path.
- Idempotent: skips writing when the name already matches.
- Silent no-op outside of a Claudian-managed vault (e.g. plain TUI sessions).

## License

MIT

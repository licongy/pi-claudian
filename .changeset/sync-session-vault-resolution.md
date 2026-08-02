---
"@pi-claudian/sync-session": patch
---

Resolve the Claudian sessions directory from the session's home (`ctx.cwd`)
instead of `process.cwd()`, walking upward to the nearest `.claudian/sessions`.
This fixes leaf/fork sync being silently skipped when a Claudian session is
resumed from a sub-directory of the vault. Path matching now goes through
`fs.realpath` so symlinked vaults compare equal.

---
"@pi-claudian/sync-title": patch
---

Resolve the Claudian sessions directory from the session's home (`ctx.cwd`)
instead of `process.cwd()`, walking upward to the nearest `.claudian/sessions`.
This fixes title sync being silently skipped when a Claudian session is resumed
from a sub-directory of the vault. The sessionFile fallback match now uses
`fs.realpath` so symlinked vaults compare equal.

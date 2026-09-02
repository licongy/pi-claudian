---
"@pi-claudian/sync-title": patch
"@pi-claudian/sync-session": patch
---

Scan Claudian 2.2.5+'s per-device metadata layout: conversation metas created by Claudian 2.2.5 live in `.claudian/sessions/devices/<deviceId>/conv-*.meta.json` instead of the sessions dir's top level where all earlier versions (and 2.2.5+ itself for pre-existing conversations) write them. Both extensions now scan both locations — top level first, then every device subdirectory — so title sync and session-tree sync keep working for conversations created under the new layout. sync-title's pending-title watcher now watches the matched meta's own directory (the sessions root, or its `devices/<deviceId>/` subdirectory), so Claudian writing a device-scoped meta is still caught within milliseconds.

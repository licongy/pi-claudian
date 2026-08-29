---
"@pi-claudian/sync-title": patch
"@pi-claudian/sync-session": patch
"@pi-claudian/auto-save-to-markdown": patch
---

Treat explicit false tokens (empty, "0", "false", "no", "off", case-insensitive) as disabling `PI_CLAUDIAN_DEBUG`, instead of enabling it on any non-empty value. Previously `PI_CLAUDIAN_DEBUG=0` turned debug logging on, since environment variables are strings and `"0"` is truthy in JavaScript.

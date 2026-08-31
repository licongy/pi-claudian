---
"sync-title": patch
---

Fix three timing gaps that delayed or dropped title sync for new Claudian conversations. The association-wait retry chain no longer dies permanently when the first message has not been sent within 10s (its early attempts scan before any content exists — slow starters survive); agent_end now retries with a short bounded chain while no meta matches yet (previously zero retries deferred the sync to the next turn), at most once per session so plain `pi` sessions are not re-polled every turn; and while a matched conversation's title is still being generated, a directory watcher on `.claudian/sessions` picks up Claudian's title write within milliseconds (the backoff retries remain as a backstop), instead of waiting for the next backoff tick.

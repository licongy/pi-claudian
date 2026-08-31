---
"pi-auto-save-to-markdown": patch
---

Never overwrite when creating a fresh archive file. Fresh full saves used the same tmp+rename write as appends, which silently replaces an existing file: two runtimes recovering the same lost file in the same second mint the same filename and overwrite each other without a trace. A fresh save now claims a free filename first, falling back to `-1`, `-2` … suffixes (the same guard rename-on-title already had), and the rename-on-title filename parser tolerates the suffixes so a suffixed file still gets renamed.

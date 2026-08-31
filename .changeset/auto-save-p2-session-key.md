---
"pi-auto-save-to-markdown": minor
---

Key the archive filename by the session instead of the branch tip. The `<key>` segment of `<title>-<key>-<time>.md` is now the first 8 hex of the SHA-256 of the session id, so every file of one session shares it — a session's files cluster in the archive directory across recoveries and resumes instead of drifting apart (the old key was a snapshot of the branch tip at file creation, which changed on every loss recovery and identified nothing stable). Save-state entries keep the `branchKey` field with this new meaning; existing files are untouched, since state entries address files by their full recorded name.

Branch switches are now reported too: when `/tree` navigation starts a new branch, the save notifies (info) that a new branch file was created and which earlier branch file is kept on disk, so multiple files of one session stay navigable.

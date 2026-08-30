---
"auto-save-to-markdown": minor
---

Rename the package from `@pi-claudian/auto-save-to-markdown` to
`auto-save-to-markdown`: the extension only uses generic Pi session APIs and
works with any Pi session, not just Claudian collaboration. Install with
`pi install npm:auto-save-to-markdown`; the old scoped name is deprecated.

Fix stale frontmatter and lost messages after the target file was deleted or
rewritten from a different tree position (e.g. a save on an older branch after
`/tree` navigation): a continuation is now only kept when the file exists and
its frontmatter `messages` count matches the branch position — otherwise a
fresh file with the full current branch is written, so no branch's newer
messages are silently stranded. State selection also now considers every
recorded save state instead of only the latest per file.

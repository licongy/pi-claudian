---
"pi-auto-save-to-markdown": minor
---

Re-render the prompt blocks the client injects into user messages (editor
selections, note references and attachments, loaded skills) as generic
callouts instead of raw XML, which Obsidian cannot render and showed as
literal angle-bracket text. Known blocks are formatted uniformly — the tag
name in words as the callout title, attribute pairs as `**name**: value`
lines (vault-relative note paths become Obsidian wikilinks), quoted content
in a collapsed callout — while agent-side skill injections collapse to a
one-line marker with the content dropped. Unknown markup is left verbatim,
and the fallback filename slug now derives from the typed message with all
injected blocks stripped.

---
"@pi-claudian/auto-save-to-markdown": patch
---

Replace HTML `<details>` folding with Obsidian callout folding in saved conversations: thinking now folds into `> [!tldr]- Thinking` and each assistant block's tool calls into `> [!quote]- Tool Calls · …`. Obsidian renders markdown inside HTML blocks unreliably (unformatted bodies, folding that does not work), while callouts fold and render markdown in both Live Preview and Reading view. Outside Obsidian the callouts degrade to plain blockquotes. Tool result previews (and argument previews) are now wrapped in inline code spans whose delimiter is sized to survive backticks inside the content, so raw tool output renders literally instead of being parsed as markdown.

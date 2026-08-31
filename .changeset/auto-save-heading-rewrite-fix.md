---
"pi-auto-save-to-markdown": patch
---

Fix rename-on-title's document-heading rewrite: the `# title` line was never actually rewritten, because the heading was located with a pattern anchored at the very first character after the frontmatter, while every file this extension writes has exactly one blank line between the frontmatter and the heading. The heading is now located as the first non-blank line after the frontmatter (a manually deleted heading still leaves the content untouched).

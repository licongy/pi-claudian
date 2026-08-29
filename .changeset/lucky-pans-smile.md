---
"@pi-claudian/auto-save-to-markdown": patch
---

Change the message info header format in saved conversations: the header is now the bare role (`User` / `Assistant`) followed by the metadata (local date-time `YYYY-MM-DD HH:MM:SS`, plus the model for assistant messages) wrapped in a small faint HTML span (`font-size: 0.5em; color: var(--text-faint)`), instead of the former `User · HH:MM:SS` / `Assistant · HH:MM:SS · model` single line. The timestamp now includes the date, the model joins with `·`, and in Obsidian the metadata renders small and faint so the role stays visually dominant. Appending to files saved by the previous format keeps existing blocks unchanged; only new blocks use the new header.

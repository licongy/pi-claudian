---
"pi-auto-save-to-markdown": patch
---

Rework the rendering of injected prompt blocks (editor selections, note references and attachments, loaded skills) in saved conversations:

- Every injected-block callout is now preset-collapsed with the `-` fold symbol — visible blocks as `> [!quote]-`, the agent-side skill marker as `> [!note]-`. Previously the fold was keyed on content presence, so the note references the client emits as self-closing tags (`<linked_content path="…" />` — no content at all) saved as always-expanded `> [!quote] Linked Content` / `Linked Note` callouts while selections and attachments saved collapsed. Obsidian only offers the fold toggle when there is body to expand, so the symbol is now uniform and free.
- The skill marker names the loaded skill in its title — `> [!note]- Skill · pi-subagents` — with the location in the body and the content dropped. Which skill was loaded is the marker's whole meaning; with the name hidden in the body, the collapsed marker showed only the meaningless word "Skill".
- Vault-shaped `path`/`location` attribute values render as bare wikilinks with no `**path**:` label — the aliased filename is self-explanatory (the file is user-provided material), so the label was noise — and lead the attribute line; other attributes keep their `**name**: value` labels.
- Consecutive visible blocks of the same tag (nothing but whitespace between them) merge into ONE callout: a user attaching five notes saves a single Linked Content callout listing five wikilinks instead of five separate callouts. Skill markers never merge — each names its own skill.

Document format bumped to 1.5 (parse-invariant rendering changes — folded callouts already existed for contentful blocks).

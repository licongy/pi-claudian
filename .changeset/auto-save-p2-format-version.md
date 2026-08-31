---
"pi-auto-save-to-markdown": minor
---

Record the document format version in the frontmatter. Every write stamps `format_version: "1.0"` — the version of the format of the LAST write, so an appended file carries the current value even when blocks inside predate it, and "claimed version vs the block formats actually present" can detect mixed-era files. MAJOR bumps mark structural breaks a parser or migration tool must handle (message header structure, `---` separators, callout syntax); MINOR bumps mark parse-invariant tweaks and bugfixes; additive frontmatter fields never bump it. Implemented independently of the planned save-doctor tool: the stamp's value as a migration handle accrues with every file written, so it starts now.

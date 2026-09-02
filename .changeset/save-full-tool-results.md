---
"pi-auto-save-to-markdown": minor
---

Save full tool call results in saved conversations instead of 500-char flattened previews. The archive is a documentary record that gets @-referenced back into conversations: a truncated half-result is wasted when the tool is called again and misleading context when it is not, and local reading (grep, ranged reads) makes size a non-issue. Results now render verbatim — whitespace intact, nothing capped — as fenced code blocks (fence sized to survive backticks inside the output) inside the existing collapsed Tool Calls callout; tool arguments drop their 160-char cap too (full argument JSON in the inline code span); the error marker moves onto the call's head line so the saved content stays exactly what the tool returned; and a result whose call was saved in an earlier file (mid-turn manual save) gets the same full treatment as a standalone block.

Document format bumped to 1.6 (MINOR — callout structure unchanged, only block bodies).

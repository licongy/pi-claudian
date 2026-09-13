---
"pi-auto-save-session-to-markdown": patch
---

Title derivation now skips a first user message that is only injected blocks (an attachment or note reference with no typed text) and reads the typed text of a later message instead: such sessions previously fell back to the "untitled" filename and title even when real typed text existed a message later.

# @pi-claudian/auto-save-to-markdown

## 0.1.0

### Minor Changes

- d44ec2d: Initial release. New Pi extension that automatically saves every
  completed conversation turn as a markdown file with YAML frontmatter (title,
  session id, tree/branch key, model, provider, cost, tokens, timestamps).

  One file per session-tree branch: continuing a branch appends new messages,
  `/tree` navigation followed by a new prompt starts a new file with the full
  branch path. Target folder defaults to `ai-conversations/` and can be changed
  via `PI_SAVE_CONVERSATION_DIR` ("." or "" saves directly in the working
  directory). A manual `/save-conversation` command saves on demand.

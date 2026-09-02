/**
 * pi-auto-save-to-markdown
 *
 * Automatically saves the current conversation to a markdown file after every
 * completed agent turn, with session metadata in a YAML frontmatter block.
 *
 * Behavior:
 *
 * - Trigger: `agent_settled` — fires once per user prompt, after the turn is
 *   fully done (including automatic retries and compaction), so each save
 *   captures a settled state of the conversation.
 * - Skip rule: every automatic path (the `agent_settled` save and the batch
 *   command's live save) skips sessions Pi does not persist — no session
 *   file, i.e. an in-memory SessionManager (`--no-session`): those are
 *   ephemeral auxiliary agents host clients spawn next to the real
 *   conversation (Claudian's title generation, instruction refinement,
 *   inline edits) or one-shot `pi --no-session` runs, not project
 *   conversations, and archiving them would mint junk "User's request …"
 *   files. The manual /save-conversation command still saves such a session
 *   on explicit demand; the batch never sees them (no jsonl on disk).
 * - Location: a subfolder of the session's working directory (`ctx.cwd`, the
 *   directory the session was started in), defaulting to `ai-conversations`.
 *   Override with the PI_SAVE_CONVERSATION_DIR environment variable; set it to
 *   "." or "" to save directly into the working directory.
 * - Filename: `<title>-<key>-<time>.md`, where <title> is the session name
 *   (or a slug of the first user message when unnamed), <key> is the first
 *   8 hex of the SHA-256 of the session id (the same value for every file
 *   of one session, so a session's files cluster in the archive directory
 *   across recoveries and resumes; when no session id exists yet — the
 *   degenerate fallback — the deepest message entry's id is hashed the
 *   same way, so the key is always an opaque 8-hex cluster key), and
 *   <time> is the local file-creation timestamp (YYYYMMDD-HHmmss).
 * - Frontmatter: title, agent (generator identity, always "pi" here — agent
 *   plugins for other runtimes would write their own value), format_version
 *   (the document format of the last write — additive frontmatter fields
 *   never bump it; see FORMAT_VERSION), session id, session key (the
 *   filename key), branch last entry id (field `branch_last_entry_id` — the
 *   id of the deepest message entry on the saved branch: the file's position
 *   in the session jsonl tree at the last write, scoped to this file's
 *   branch, not the session-wide last entry), model, provider, cumulative
 *   cost and tokens (input, output,
 *   cache read/write), message count, created/updated timestamps (tz-aware
 *   ISO 8601 in the local timezone with its numeric UTC offset, e.g.
 *   "2026-08-29T13:05:12+08:00"), project root and session file.
 * - Body format: every message block opens with a setext-H1 info header
 *   (`User <span …>YYYY-MM-DD HH:MM:SS</span>` /
 *   `Assistant <span …>YYYY-MM-DD HH:MM:SS · model</span>`, where the span
 *   renders the metadata as small faint text — Obsidian CSS variables, so it
 *   degrades gracefully elsewhere — underlined with `===`, distinct from the
 *   `#`/`##` ATX headings AI content uses) and ends with a `---` separator
 *   wrapped in single blank lines.
 * - Tool call/result folding: calls live in the assistant entry while their
 *   results are separate toolResult entries; saves pair them by toolCall id
 *   and fold each assistant block's calls, with their FULL results, into one
 *   collapsed Obsidian callout (`> [!quote]- Tool Calls · …`). Thinking folds
 *   the same way into `> [!tldr]- Thinking`. Callouts are used instead of
 *   HTML `<details>` because Obsidian's views render embedded markdown
 *   inside HTML blocks unreliably, while callouts fold and render markdown
 *   in both Live Preview and Reading view. Outside Obsidian the callouts
 *   degrade to plain blockquotes. Arguments render as full JSON in inline
 *   code spans and results verbatim — whitespace intact, nothing capped —
 *   in fenced code blocks (delimiters sized to survive backticks inside the
 *   content), so raw output renders literally instead of being parsed as
 *   markdown. Nothing is truncated because the file is a documentary record
 *   that may be @-referenced back into a conversation: a half result is
 *   wasted when the tool is called again and misleading when it is not,
 *   while local reading (grep, ranged reads) makes size a non-issue. A
 *   result whose call was saved in an earlier file (mid-turn manual save)
 *   renders as a standalone block with the same full content.
 * - Injected prompt blocks: the host client and the agent runtime append
 *   machine-readable XML to user messages — the editor's active selection
 *   (CDATA content), note references and attachments (linked_note /
 *   linked_content), loaded skills, and their kin. Raw markup is noise
 *   Obsidian cannot render (unknown tags are not HTML; CDATA is XML), so
 *   every block in a known vocabulary is re-rendered generically (see
 *   markdown.ts) — no per-tag formatting: the callout title is the tag name
 *   in words, the body opens with vault-shaped path/location values as
 *   bare wikilinks (the aliased filename is self-explanatory — a `path:`
 *   label is noise) followed by the remaining attributes as
 *   "**name**: value" lines, then the content (the client's `]]>`
 *   split-escaping reversed). Every callout is preset-collapsed: visible
 *   blocks (selections, note references, attachments) as `> [!quote]-`,
 *   whether they carry content or only attributes (the client emits note
 *   references as self-closing tags whose whole payload is a path
 *   attribute), agent-side traces (skills) as a `> [!note]- Skill · <name>`
 *   marker — the loaded skill's name rides the title so the collapsed
 *   marker still says which skill, the location follows in the body, the
 *   content is dropped — and consecutive visible same-tag blocks (nothing
 *   but whitespace between them) merge into one callout, so a run of note
 *   references collapses into a single list (skill markers never merge:
 *   each names its own skill). Title
 *   derivation strips every known block — the typed message is the title.
 *   Unknown markup is left verbatim so XML pasted as content is never
 *   mangled.
 * - Branching: each file records exactly ONE branch (the root→leaf path
 *   returned by sessionManager.getBranch()). State is persisted via
 *   `pi.appendEntry()` custom entries, which are part of the session tree
 *   itself — they are not sent to the LLM and not rendered in the TUI. State
 *   discovery reads those entries straight from the session jsonl on disk
 *   (the shared append log is the single source of truth), so a warm process
 *   whose in-memory tree lags behind still sees states recorded by other
 *   runtimes; the in-memory tree is only a fallback when the file is
 *   unavailable. Every save ranks the recorded states whose saved position
 *   lies on the current path — deepest first, and among equal positions the
 *   state recorded LAST wins: it names the file the latest successful save
 *   actually wrote, older ones name superseded files. If the tree moved
 *   elsewhere (e.g. /tree navigation followed by a new prompt), no position
 *   matches and a new file is created with the full current branch, with an
 *   info notice naming the earlier branch's kept file so the switch stays
 *   visible in the archive. Continuing an existing branch appends only the
 *   messages that are new since the last save.
 * - Recovery: candidates are validated newest-first — the target file must
 *   exist AND its frontmatter `messages` count must cover the messages
 *   already saved for this branch (a count that exceeds it is fine — a
 *   descendant branch extended the same file); the first candidate that
 *   passes is continued. If the newest candidate fails but an older one
 *   validates, the save downgrades to the older file and warns about it
 *   (converging on existing files instead of minting new ones). Only when
 *   every candidate fails — deleted files, or files rewritten from a
 *   different tree position (e.g. /tree navigation plus a save on an older
 *   branch), where continuing could silently strand this branch's newer
 *   messages — is a brand-new file with the full current branch written.
 *   Recoveries and downgrades are never silent: each is reported as a
 *   warning naming the failed target and the likely cause (something
 *   moving/deleting files for a missing target; a concurrent runtime or an
 *   older extension version for a count mismatch). A fresh file never
 *   overwrites an existing filename either (-1, -2 … suffixes claim a free
 *   one): two runtimes recovering the same lost file in the same second
 *   would otherwise mint the same name and silently overwrite each other.
 *   Every branch therefore always ends up with a complete, consistent file.
 * - Rename-on-title: the first save usually happens before the session has
 *   its real name (Claudian generates the title only after the first reply),
 *   so the file is created with a slug of the first user message. Once the
 *   name exists, the next save renames that file exactly once, to
 *   "<name>-<key>-<original-timestamp>.md" — the original timestamp keeps
 *   the file's birthday (and makes concurrent or retried renames converge
 *   on one name), the frontmatter title and the document heading are
 *   rewritten to match, and the state entry records the new name with
 *   titled=true. One-way and one-time: a later user /name change never
 *   touches the filename, and legacy files (state entries predating the
 *   titled flag) are only renamed when their name segment equals the
 *   recomputed fallback slug, so manually organized filenames stay
 *   untouched. A rename never overwrites an existing target (-1, -2 …
 *   suffixes); a failed rename keeps the old filename — the title fields
 *   were already fixed — and retries on the next save.
 * - Mixed versions: every state entry records its save-state schema version
 *   ("MAJOR.MINOR", numbered independently of the package version) plus the
 *   writer's package version. A warm process can outlive a package upgrade
 *   and keep running pre-upgrade code against the same session; when a save
 *   sees state entries written by a NEWER schema, it warns (once per
 *   session) to restart. Older or unknown schemas are ignored — they are
 *   indistinguishable from this session's own pre-upgrade history.
 * - Compaction: files archive the ORIGINAL messages (getBranch() returns the
 *   raw tree path, not the compaction-aware context), so a compacted session
 *   still exports its complete history.
 * - Thinking repair: reasoning blocks stored with the upstream
 *   newline-fragmentation corruption (one word per line) are detected and
 *   re-joined into flowing text before saving, keeping paragraph breaks
 *   where they survive as long separator runs after sentence ends; clean
 *   thinking is untouched.
 *
 * Manual commands:
 * - `/save-conversation` saves the current branch immediately and reports
 *   the file path.
 * - `/save-conversation-all` saves EVERY session of the current project
 *   (every session jsonl in the project's `~/.pi/agent/sessions` folder):
 *   each session through the exact same pipeline — state candidates, the
 *   never-overwrite guard, rename-on-title, recovery warnings — with its
 *   archive written under that session's own working directory. Sessions
 *   without an assistant reply are skipped; the current session saves
 *   through the normal live path first. Idempotent: re-running continues
 *   or reports "up to date" per session, never re-creating files. A session
 *   whose jsonl changes while it is being processed (it is still being
 *   written by its own runtime) is deferred to the next run instead of
 *   racing the other writer — the save only proceeds when the file is
 *   verified unchanged since it was read (optimistic concurrency control;
 *   the state line the batch appends to a foreign session jsonl is
 *   byte-identical to what pi's own appendCustomEntry would write).
 *
 * Installation:
 *   pi install npm:pi-auto-save-to-markdown
 *
 * Debug:
 *   PI_CLAUDIAN_DEBUG=1 pi
 */

import type {
  AgentSettledEvent,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  SessionEntry,
  SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { debug } from "./debug.js";
import {
  callout,
  fencedCode,
  inlineCode,
  renderUserMessageText,
  stripInjectedBlocks,
} from "./markdown.js";

const CUSTOM_TYPE = "pi-claudian-auto-save-markdown";
const ENV_SUBDIR = "PI_SAVE_CONVERSATION_DIR";
const DEFAULT_SUBDIR = "ai-conversations";
const COMMAND = "save-conversation";
const COMMAND_ALL = "save-conversation-all";
const NOTIFY_TAG = "[AutoSave]";
/**
 * Generator identity recorded in the frontmatter. This extension only ever
 * runs inside Pi, so the value is constant; the field is reserved so a future
 * extension for a different agent (opencode, codex, …) can write its own.
 */
const AGENT = "pi";

/**
 * Schema version of the save-state entries this extension writes, formatted
 * "MAJOR.MINOR" and numbered independently of the package version: MAJOR for
 * incompatible state changes, MINOR for backward-compatible additions. A
 * state entry written by a NEWER schema means some other runtime in this
 * session is running a newer version of the extension (a warm process that
 * outlived a package upgrade) — see the mixed-version warning in computePlan.
 * Bump MINOR when adding optional state fields, MAJOR when changing existing
 * state semantics.
 */
const SAVE_STATE_SCHEMA = "1.2";

/**
 * Version of the markdown document format this code writes ("MAJOR.MINOR",
 * numbered independently of the save-state schema above). Semantics: the
 * version of the LAST writer — an appended file is stamped with the current
 * value even when blocks inside predate it, so "claimed version vs the block
 * formats actually present" detects mixed-era files. Bump rules: MAJOR for
 * structural breaks that change how a parser or migration tool must match
 * blocks (message header structure, `---` separators, callout syntax);
 * MINOR for parse-invariant tweaks and bugfixes (header styling, content
 * transforms like the thinking repair, the blank line once written between
 * the frontmatter and the document heading); additive frontmatter fields do
 * NOT bump it — they are invisible to any within-major parser.
 */
const FORMAT_VERSION = "1.6";

/**
 * Package version of this extension, read best-effort from the adjacent
 * package.json at load time. Recorded in state entries purely so the
 * mixed-version warning can name the newer writer; never used for comparison.
 */
const EXTENSION_VERSION: string | null = (() => {
  try {
    const pkg: unknown = JSON.parse(
      fsSync.readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
    );
    const v = (pkg as { version?: unknown }).version;
    return typeof v === "string" && v ? v : null;
  } catch {
    return null;
  }
})();

const MAX_TITLE_LENGTH = 60;
const TITLE_FALLBACK_LENGTH = 40;
type AgentMessage = SessionMessageEntry["message"];
type UserMessage = Extract<AgentMessage, { role: "user" }>;
type AssistantMessage = Extract<AgentMessage, { role: "assistant" }>;
type ToolResultMessage = Extract<AgentMessage, { role: "toolResult" }>;

/**
 * Per-save state persisted in the session tree via pi.appendEntry().
 * `file` is the bare filename inside the target directory, so changing the
 * configured directory (env var) moves future saves without breaking
 * resolution — the file is simply recreated from the full branch if missing.
 * `schema`/`extVersion` are absent on entries written before they existed;
 * unknown extra fields on newer entries are ignored here (forward
 * compatibility), so validation only covers the fields this code reads.
 */
interface SaveState {
  /**
   * Key segment of the filename this state addresses: the first 8 hex of the
   * SHA-256 of the session id — stable per session, so files of one session
   * cluster together (when no session id exists yet, the deepest message
   * entry's id is hashed the same way). Only ever used as the recorded
   * value — files are addressed by their full recorded name, never recomputed
   * from the key. Renamed from branchKey at schema 1.2: legacy entries fail
   * validation and are ignored — those branches get fresh files.
   */
  sessionKey: string;
  /**
   * Id of the session tree leaf at save time (getLeafId()) — may be a custom
   * state entry rather than a message; used to rank continuation candidates
   * on the current path. Distinct from frontmatter `branch_last_entry_id`,
   * which is the deepest message entry (an id actually present in the file).
   */
  lastSavedEntryId: string | null;
  file: string;
  /** Save-state schema version ("MAJOR.MINOR") of the writer. */
  schema?: string;
  /** Package version of the writer, warning text only. */
  extVersion?: string;
  /**
   * Whether the file was created with the session's real name (true) or
   * with the fallback slug (false). Absent on legacy entries written before
   * the rename-on-title feature — those are judged by recomputing the
   * fallback slug against the actual filename. Once true it never goes back:
   * a later user /name change must not re-trigger a filename rename.
   */
  titled?: boolean;
}

/** Parse a "MAJOR.MINOR" schema version into numeric parts. */
function parseSchemaVersion(v: string): [number, number] | null {
  const m = /^(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/**
 * Strictly-newer check, numeric per segment — never lexicographic ("1.10"
 * must count as newer than "1.9"). Unparseable versions are treated as
 * unknown and therefore not newer.
 */
function isNewerSchemaVersion(other: string, mine: string): boolean {
  const a = parseSchemaVersion(other);
  const b = parseSchemaVersion(mine);
  if (!a || !b) return false;
  return a[0] !== b[0] ? a[0] > b[0] : a[1] > b[1];
}

function isSaveState(v: unknown): v is SaveState {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.sessionKey === "string" &&
    s.sessionKey.length > 0 &&
    (s.lastSavedEntryId === null || typeof s.lastSavedEntryId === "string") &&
    typeof s.file === "string" &&
    s.file.length > 0
  );
}

/**
 * The save pipeline's complete view of a session: the narrow surface it needs
 * from the host, so the exact same pipeline code runs for the live session
 * (backed by the real ExtensionContext and pi.appendEntry) and for any other
 * session of the project (backed by DiskSessionView, rebuilt from the session
 * jsonl on disk, with state entries appended directly). The interface is a
 * structural subset of pi's ExtensionContext/SessionManager, so the live
 * adapter passes the real objects through unchanged — the batch feature is
 * pure parameterization, byte-identical on the live path.
 */
interface SaveContext {
  /** Working directory of the session — resolves the archive folder. */
  readonly cwd: string;
  /** Whether a UI surface exists; notify() is a no-op without one. */
  readonly hasUI: boolean;
  /** Fire-and-forget notification, guarded by hasUI. */
  notify(message: string, level: "info" | "warning" | "error"): void;
  /** Read-only session surface (structural subset of pi's SessionManager). */
  readonly session: {
    getBranch(): SessionEntry[];
    getEntries(): SessionEntry[];
    getSessionId(): string;
    getSessionFile(): string | undefined;
    getSessionName(): string | undefined;
    getLeafId(): string | null;
  };
  /**
   * Save-state discovery: disk-first for the live session; for disk views,
   * the states parsed from the load snapshot — a fresh re-read could see
   * entries newer than the frozen snapshot the save is based on, and
   * consistency beats freshness.
   */
  readSaveStates(): Promise<SaveState[] | null>;
  /** Warn about a state entry written by a newer schema — once per session. */
  warnMixedVersion(state: SaveState): void;
  /**
   * Concurrency guard before this save's first write. No-op for the live
   * session (its writes are serialized through pi in-process). A disk view
   * verifies its jsonl is unchanged since load (optimistic concurrency
   * control — the file only ever grows, so the size at load is the version
   * token) and throws SessionChangedError when another writer got in,
   * deferring the session to the next run.
   */
  beforeWrite(): Promise<void>;
  /**
   * Persist this run's state entry: pi.appendEntry for the live session; for
   * a disk view, a directly-appended jsonl line in the exact format pi's own
   * appendCustomEntry/_persist writes (pi 0.82.1), parentId = the snapshot's
   * last entry — the same topology an in-session save would leave.
   */
  appendState(state: SaveState): Promise<void>;
}

/** A foreign session jsonl changed on disk between load and write — defer. */
class SessionChangedError extends Error {}

interface SaveResult {
  message: string;
  /** A file was actually written (created or appended). */
  wrote: boolean;
  /** The write created a brand-new file (vs appending to an existing one). */
  created: boolean;
  file: string | null;
  /** Why a planned continuation was replaced by a fresh full save, if it was. */
  recovered: string | null;
  /**
   * Set when a fresh file was created because the tree moved to a different
   * branch: the previous branch's file that stays on disk (info notice —
   * the branch change is normal one-branch-one-file behavior, not a warning).
   */
  switchedFrom: string | null;
  /** The write included a rename-on-title move of the file (info notice). */
  renamed: boolean;
}

interface BranchMeta {
  title: string;
  /** Generator identity; preserved from the file being appended to. */
  agent: string;
  sessionId: string | null;
  sessionFile: string | null;
  /**
   * The filename key, mirrored into the frontmatter so the file is
   * self-describing (field name `session_key`): the first 8 hex of the
   * SHA-256 of the session id, or of the deepest message entry's id when
   * no session id exists yet. A display/grouping key only — never used to
   * address files (states record full filenames).
   */
  sessionKey: string;
  /**
   * Id of the deepest message entry on the saved branch at the last write
   * (field name `branch_last_entry_id`) — the file's exact position in the
   * session jsonl tree, scoped to this file's branch rather than the
   * session-wide last entry. Updated on every append, like `updated`.
   */
  branchLastEntryId: string;
  model: string | null;
  provider: string | null;
  cost: number;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  messages: number;
  created: string;
  updated: string;
  projectRoot: string;
}

// ---------- thinking fragmentation repair ----------

/**
 * Some upstream reasoning streams (observed with z-ai/GLM via OpenRouter) store
 * thinking as one word — or one CJK character — per line: the stream splits
 * tokens into fragments joined by runs of newlines, and the original spaces
 * survive only as leading spaces of the fragments. The saved markdown then has
 * every token on its own line, which is miserable to read and bloats storage.
 *
 * Detection uses two signatures validated against ~520 real thinking blocks:
 * lines starting with exactly one space (a survived word separator; blank-ish
 * " " lines included), and an excess of 1–2-char non-list-marker lines (CJK
 * fragments carry no leading space). Clean thinking never matches either.
 *
 * Repair re-joins the fragments into flowing text. Word separators — the
 * whitespace runs between two fragments — lose their newlines: run length
 * alone carries no recoverable meaning, because the same word separator
 * appears as 1, 2 or 3 newlines depending on the block. Original paragraph
 * boundaries survive as a faint but strong signal: a separator run of 3+
 * newlines that follows a sentence-final character (closing quotes and
 * brackets skipped when looking) marks a real paragraph break 73–93% of the
 * time in corrupted blocks, while plain word separators sit mid-sentence —
 * so exactly those separators become blank-line paragraph breaks and
 * everything else is joined. The sentence-final guard means a break is never
 * inserted mid-sentence: worst case, one lands between two complete
 * sentences, which still reads fine. Join spacing comes from the separator
 * itself: a separator containing a surviving space joins with one space, a
 * bare one (CJK fragments, attached punctuation) joins with nothing. Clean
 * blocks pass through untouched.
 */

/** Line whose single leading space is a survived word separator. */
function isThinkingSigLine(line: string): boolean {
  return line === " " || /^ [^ *+\-\d]/.test(line);
}

/** Non-blank line of 1–2 chars that is not a standalone list marker. */
function isThinkingShortFragment(line: string): boolean {
  const s = line.trim();
  if (s.length === 0 || s.length > 2) return false;
  return !/^([-*+]|\d+[.)])$/.test(s);
}

/** Whether a thinking block shows the newline-fragmentation corruption. */
function isFragmentedThinking(s: string): boolean {
  const lines = s.split("\n");
  const nonBlank = lines.filter((l) => l.trim().length > 0);
  if (nonBlank.length === 0) return false;
  const sig = lines.filter(isThinkingSigLine).length;
  if (nonBlank.length < 8) return nonBlank.length >= 3 && sig >= 3;
  if (sig / lines.length >= 0.12) return true;
  return nonBlank.filter(isThinkingShortFragment).length / nonBlank.length >= 0.4;
}

/** Sentence-final characters: a long separator run after one may be a paragraph break. */
const THINKING_SENTENCE_END = /[.!?。！？…]/;
/** Closing punctuation skipped when looking for the sentence end behind it. */
const THINKING_CLOSING = /[)\]}"'”』」）】》]/;
/** Newlines a separator run needs before it can count as a paragraph break. */
const THINKING_PARAGRAPH_RUN = 3;

/** Repair newline-fragmented thinking; clean thinking is returned unchanged. */
function repairThinking(s: string): string {
  if (!isFragmentedThinking(s)) return s;
  debug("repairing fragmented thinking block:", s.length, "chars");
  let out = "";
  let i = 0;
  while (i < s.length) {
    let end = i;
    while (end < s.length && !/\s/.test(s[end])) end++;
    out += s.slice(i, end);
    let next = end;
    while (next < s.length && /\s/.test(s[next])) next++;
    if (next >= s.length) break; // trailing whitespace: drop
    const sep = s.slice(end, next);
    if (!/[\n\r]/.test(sep)) {
      out += " "; // plain spaces: a single word separator
    } else {
      const newlines = sep.match(/[\n\r]/g)!.length;
      let p = out.length - 1;
      while (p >= 0 && THINKING_CLOSING.test(out[p])) p--;
      const sentenceEnd = p >= 0 && THINKING_SENTENCE_END.test(out[p]);
      if (newlines >= THINKING_PARAGRAPH_RUN && sentenceEnd) out += "\n\n";
      else if (/[ \t]/.test(sep)) out += " ";
      // A bare newline separator attached CJK fragments or punctuation:
      // join with nothing.
    }
    i = next;
  }
  return out.replace(/[ \t]{2,}/g, " ").trim();
}

// ---------- foreign sessions for /save-conversation-all ----------

function isMessageEntry(e: SessionEntry): e is SessionMessageEntry {
  return e.type === "message";
}

/**
 * pi has no extension API for enumerating or loading other sessions, so the
 * batch command rebuilds each session straight from its jsonl on disk. The
 * formats below were verified against pi 0.82.1's session-manager (PRD §5
 * P3, F2/F10): entries are `{type, id, parentId, timestamp, …}` trees where
 * the FIRST `type: "session"` header carries the session id and cwd; loading
 * sets the leaf to the LAST entry in file order (there is no persisted leaf
 * pointer), and the branch is the parentId chain walked from it — exactly
 * what pi itself does on resume, so the batch saves the same branch the
 * session would resume onto. Session names come from the latest
 * `session_info` entry, also like pi.
 */

/** Result of loading one session file for the batch. */
type LoadedSession =
  | { kind: "view"; view: DiskSessionView }
  /** The file changed while being read (still written by its runtime) — retry next run. */
  | { kind: "deferred" }
  /** Not eligible this run. "legacy" = pre-id/parentId entries (v1) — see loadDiskSession. */
  | { kind: "skip"; reason: "no-assistant" | "legacy" };

class DiskSessionView implements SaveContext {
  readonly cwd: string;
  readonly hasUI = true;
  readonly session: SaveContext["session"];
  readonly file: string;
  private readonly entries: SessionEntry[];
  private readonly pathEntries: SessionEntry[];
  private readonly states: SaveState[];
  private readonly sizeAtLoad: number;
  private readonly sessionId: string;
  private readonly name: string | undefined;
  private readonly leafId: string | null;
  private readonly sink: (message: string, level: "info" | "warning" | "error") => void;
  /** Info notices are aggregated by the batch runner instead of shown one by one. */
  infoNotices = 0;

  constructor(opts: {
    file: string;
    entries: SessionEntry[];
    pathEntries: SessionEntry[];
    states: SaveState[];
    sizeAtLoad: number;
    sessionId: string;
    cwd: string;
    name: string | undefined;
    leafId: string | null;
    sink: (message: string, level: "info" | "warning" | "error") => void;
  }) {
    this.file = opts.file;
    this.entries = opts.entries;
    this.pathEntries = opts.pathEntries;
    this.states = opts.states;
    this.sizeAtLoad = opts.sizeAtLoad;
    this.sessionId = opts.sessionId;
    this.cwd = opts.cwd;
    this.name = opts.name;
    this.leafId = opts.leafId;
    this.sink = opts.sink;
    this.session = {
      getBranch: () => this.pathEntries,
      getEntries: () => this.entries,
      getSessionId: () => this.sessionId,
      getSessionFile: () => this.file,
      getSessionName: () => this.name,
      getLeafId: () => this.leafId,
    };
  }

  /** Short session identity for per-session batch notices. */
  tag(): string {
    return this.sessionId.slice(0, 8);
  }

  notify(message: string, level: "info" | "warning" | "error"): void {
    if (level === "info") {
      // Batch aggregates info notices into the summary count.
      this.infoNotices++;
      debug(this.tag(), message);
    } else {
      // Warnings and errors are anomalies — one per session, tagged.
      this.sink(`[${this.tag()}] ${message}`, level);
    }
  }

  readSaveStates(): Promise<SaveState[] | null> {
    // The frozen load snapshot, never a fresh re-read (see SaveContext).
    return Promise.resolve(this.states);
  }

  warnMixedVersion(state: SaveState): void {
    // Once per session (PRD 0.3: warn-once is per session; the live adapter
    // keeps its per-process latch for the live path).
    if (warnedSessions.has(this.sessionId)) return;
    warnedSessions.add(this.sessionId);
    const writer = state.extVersion
      ? `extension v${state.extVersion} (save-state schema ${state.schema})`
      : `save-state schema ${state.schema}`;
    debug(
      this.tag(),
      "mixed versions: state entries written by",
      writer,
      "— this code is",
      SAVE_STATE_SCHEMA,
    );
    this.notify(
      `this session was written to by a newer ${writer}, while this process runs older code — restart the session / reload Pi to load the new version`,
      "warning",
    );
  }

  /** OCC: the file must be byte-identical to the load snapshot. */
  private async assertUnchanged(): Promise<void> {
    let size: number;
    try {
      size = (await fs.stat(this.file)).size;
    } catch {
      throw new SessionChangedError("session file vanished since load");
    }
    if (size !== this.sizeAtLoad) {
      throw new SessionChangedError("session file changed since load");
    }
  }

  beforeWrite(): Promise<void> {
    return this.assertUnchanged();
  }

  async appendState(state: SaveState): Promise<void> {
    // Last-resort OCC check immediately before the append: a session written
    // to after this point cannot be helped (the µs stat→append window is
    // accepted, PRD §9.6 D7), but anything earlier is caught here.
    await this.assertUnchanged();
    const entry = {
      type: "custom" as const,
      customType: CUSTOM_TYPE,
      data: state,
      id: this.generateId(),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
    };
    // Single small line via O_APPEND — the same single-write append pi's
    // _persist does; a concurrent writer interleaves at line granularity
    // at worst, and every reader skips bad lines.
    await fs.appendFile(this.file, JSON.stringify(entry) + "\n", "utf-8");
    debug(this.tag(), "recorded state entry — sessionKey:", state.sessionKey, "file:", state.file);
  }

  /** pi's generateId semantics: random 8-hex, collision-checked against the session's ids. */
  private generateId(): string {
    for (let i = 0; i < 100; i++) {
      const id = randomUUID().slice(0, 8);
      if (!this.entries.some((e) => e.id === id)) return id;
    }
    return randomUUID();
  }
}

/** Sessions warned about mixed save-state schemas by the batch (per session). */
const warnedSessions = new Set<string>();

/**
 * Load one foreign session jsonl for the batch: read it once (OCC — the size
 * is captured before the read and re-checked after, so the snapshot is
 * exactly the file as of that size), then rebuild the tree and its current
 * branch. Skips: sessions with no assistant reply (nothing conversational to
 * archive — pi does not even persist sessions until their first assistant
 * entry, so this is mostly a defense against partial/corrupt files); v1-era
 * files with pre-id/parentId entries — pi rewrites those on load with ids of
 * its own choosing, so a state line we append (parentId pointing at OUR
 * synthetic ids) would become an orphan root and steal the resume position
 * once pi migrates the file, and archiving without a state entry would mint a
 * duplicate file on every run. Skipping is the only safe treatment.
 */
async function loadDiskSession(
  file: string,
  sink: (message: string, level: "info" | "warning" | "error") => void,
): Promise<LoadedSession> {
  const before = await fs.stat(file); // OCC version token S0
  const text = await fs.readFile(file, "utf-8");
  const after = await fs.stat(file);
  if (after.size !== before.size) return { kind: "deferred" };

  const raw: unknown[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      raw.push(JSON.parse(line));
    } catch {
      continue; // skip corrupt / mid-write lines (pi's own loader does the same)
    }
  }

  const header = raw.find(
    (e): e is { type: "session"; id?: unknown; cwd?: unknown } =>
      typeof e === "object" && e !== null && (e as { type?: unknown }).type === "session",
  );
  if (
    !header ||
    typeof header.id !== "string" ||
    !header.id ||
    typeof header.cwd !== "string" ||
    !header.cwd
  ) {
    throw new Error("no valid session header");
  }

  const entries: SessionEntry[] = [];
  let sawLegacy = false;
  for (const e of raw) {
    if (typeof e !== "object" || e === null) continue;
    const r = e as Record<string, unknown>;
    if (r.type === "session") continue; // header — not part of the tree
    // v1-era entries have no id/parentId structure (pi's migrateV1ToV2
    // assigns them at load time). See the function doc for why we skip.
    if (typeof r.id !== "string" || r.parentId === undefined) {
      sawLegacy = true;
      break;
    }
    if (r.type === "message" && typeof r.message !== "object") continue; // corrupt
    entries.push(e as SessionEntry);
  }
  if (sawLegacy) return { kind: "skip", reason: "legacy" };

  if (!entries.some((e) => isMessageEntry(e) && e.message.role === "assistant")) {
    return { kind: "skip", reason: "no-assistant" };
  }

  const byId = new Map<string, SessionEntry>();
  for (const e of entries) byId.set(e.id, e);
  // pi's _buildIndex: leaf = last entry in file order (there is no persisted
  // leaf pointer — the file's last line IS the resume position, F10).
  const leafId = entries.length > 0 ? entries[entries.length - 1].id : null;

  // Current branch: parentId chain walked from the leaf, exactly like
  // SessionManager.getBranch. The iteration cap is paranoia against cycles.
  const pathEntries: SessionEntry[] = [];
  {
    let current = leafId !== null ? byId.get(leafId) : undefined;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      pathEntries.push(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    pathEntries.reverse();
  }

  // Latest session_info name, reverse-walked (SessionManager.getSessionName).
  let name: string | undefined;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.type === "session_info") {
      name = e.name?.trim() || undefined;
      break;
    }
  }

  const states: SaveState[] = [];
  for (const e of entries) {
    if (e.type === "custom" && e.customType === CUSTOM_TYPE && isSaveState(e.data)) {
      states.push(e.data);
    }
  }

  debug(
    "loaded session for batch:",
    path.basename(file),
    "— entries:",
    entries.length,
    "path:",
    pathEntries.length,
    "states:",
    states.length,
  );
  return {
    kind: "view",
    view: new DiskSessionView({
      file,
      entries,
      pathEntries,
      states,
      sizeAtLoad: before.size,
      sessionId: header.id,
      cwd: header.cwd,
      name,
      leafId,
      sink,
    }),
  };
}

/**
 * The project's sessions directory: the folder holding the live session's
 * jsonl. Fallback for file-less (in-memory) live sessions mirrors pi's
 * encoding (session-manager v0.82.1: cwd with /, \, : turned into dashes,
 * wrapped in -- … --) under the default ~/.pi/agent/sessions.
 */
function defaultSessionsDir(cwd: string): string {
  const safe = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return path.join(os.homedir(), ".pi", "agent", "sessions", safe);
}

export default function (pi: ExtensionAPI) {
  /**
   * Resolve the target directory. The env var may hold a relative folder name
   * (resolved against the session cwd), an absolute path, or "." / "" for the
   * working directory itself. When unset, the default subfolder is used.
   */
  function targetDir(ctx: SaveContext): string {
    const env = process.env[ENV_SUBDIR];
    if (env === undefined) return path.join(ctx.cwd, DEFAULT_SUBDIR);
    const raw = env.trim();
    if (raw === "" || raw === ".") return ctx.cwd;
    return path.resolve(ctx.cwd, raw);
  }

  // ---------- formatting helpers ----------

  function pad(n: number): string {
    return String(n).padStart(2, "0");
  }

  /** Local-time filename timestamp: YYYYMMDD-HHmmss. */
  function fileTimestamp(d: Date): string {
    return (
      `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
      `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
    );
  }

  /** Local-time label for a message entry: YYYY-MM-DD HH:MM:SS. */
  function dateTime(iso: string): string {
    const d = new Date(iso);
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      ` ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    );
  }

  /**
   * Wrap header metadata (timestamp, model) in a small faint span: 0.5em text
   * in Obsidian's `--text-faint` color, so the role stays visually dominant.
   * HTML-escaped because the model string lands inside a raw HTML span.
   */
  function metaSpan(text: string): string {
    const safe = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<span style="font-size: 0.5em; color: var(--text-faint);">${safe}</span>`;
  }

  /** Setext-H1 info header: `Role <span …>meta</span>` underlined with `===`. */
  function messageHeader(role: string, meta: string): string {
    return `${role} ${metaSpan(meta)}\n===`;
  }

  /** Make a string safe for use as a filename component. */
  function sanitizeFilenamePart(s: string): string {
    return s
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\s/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, MAX_TITLE_LENGTH)
      .replace(/[-.]+$/g, "");
  }

  /** Extract the plain text of a user message content (string or blocks). */
  function userText(content: UserMessage["content"]): string {
    if (typeof content === "string") return content;
    return content
      .map((b) =>
        b.type === "text" ? b.text : `_[image: ${"mimeType" in b ? b.mimeType : "unknown"}]_`,
      )
      .join("\n\n");
  }

  function firstUserText(messages: SessionMessageEntry[]): string | undefined {
    for (const e of messages) {
      if (e.message.role === "user") {
        // Title derivation reads the plain typed message — every known
        // injected block (see markdown.ts) is stripped, mirroring how the
        // client strips the same blocks for its own session titles.
        return stripInjectedBlocks(userText(e.message.content)) || undefined;
      }
    }
    return undefined;
  }

  /** Fallback filename title: a slug of the first user message. */
  function fallbackTitleForFilename(firstUser: string | undefined): string {
    if (firstUser) {
      const slug = sanitizeFilenamePart(firstUser.slice(0, TITLE_FALLBACK_LENGTH));
      if (slug) return slug;
    }
    return "untitled";
  }

  /** Title for the filename: session name, else a slug of the first user message. */
  function titleForFilename(ctx: SaveContext, firstUser: string | undefined): string {
    const name = ctx.session.getSessionName()?.trim();
    return name ? sanitizeFilenamePart(name) || "untitled" : fallbackTitleForFilename(firstUser);
  }

  /** Title for the frontmatter / document heading. */
  function displayTitle(ctx: SaveContext, firstUser: string | undefined): string {
    const name = ctx.session.getSessionName()?.trim();
    if (name) return name;
    if (firstUser) {
      const snippet = firstUser.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_LENGTH);
      if (snippet) return snippet;
    }
    return "untitled";
  }

  /** Full argument JSON on one line (JSON.stringify escapes newlines), never truncated. */
  function renderArgs(args: unknown): string {
    try {
      return JSON.stringify(args) ?? "";
    } catch {
      return String(args);
    }
  }

  // ---------- markdown rendering ----------

  /**
   * Strip leading blank lines and trailing whitespace from a rendered block,
   * so joins and separators always keep exactly one blank line around them
   * no matter what blank lines the content itself starts or ends with.
   */
  function tighten(s: string): string {
    return s.replace(/^(?:[ \t]*\n)+/, "").replace(/\s+$/, "");
  }

  /** One tool call with its paired full result (null when no result entry exists). */
  interface RenderedToolCall {
    name: string;
    args: string;
    result: string | null;
    error: boolean;
  }

  /**
   * Full raw result text: text blocks joined with blank lines, non-text
   * blocks as placeholders. Error status stays OUT of the content (it rides
   * the call's head line) so the saved text is exactly what the tool
   * returned.
   */
  function resultText(m: ToolResultMessage): string {
    const texts: string[] = [];
    for (const b of m.content) {
      if (b.type === "text") texts.push(b.text);
      else texts.push(`_[image: ${b.mimeType}]_`);
    }
    return texts.join("\n\n").trim();
  }

  /**
   * Standalone block for a result whose call is not in this file — same full
   * content as folded results.
   */
  function renderToolResult(m: ToolResultMessage): string {
    const text = resultText(m);
    const err = m.isError ? " (error)" : "";
    return `**Tool · ${m.toolName}**${err}\n\n${text ? fencedCode(text) : "_(empty result)_"}`;
  }

  /** "read, web_search ×2" — tool names with repeat counts, first-seen order. */
  function summarizeToolNames(names: string[]): string {
    const counts = new Map<string, number>();
    for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
    return [...counts].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(", ");
  }

  /**
   * Fold tool calls and their paired results into one collapsed callout.
   * Arguments render as full JSON in inline code spans and results verbatim
   * in fenced code blocks, so raw output renders literally instead of being
   * parsed as markdown.
   */
  function renderToolCallsCallout(calls: RenderedToolCall[]): string {
    const summary = summarizeToolNames(calls.map((c) => c.name));
    const items = calls.map((c) => {
      const err = c.error ? " (error)" : "";
      const head = c.args
        ? `**\`${c.name}\`**${err} ${inlineCode(c.args)}`
        : `**\`${c.name}\`**${err}`;
      const result =
        c.result === null ? "_(no result)_" : c.result ? fencedCode(c.result) : "_(empty result)_";
      return `${head}\n\n${result}`;
    });
    return callout("quote", `Tool Calls · ${calls.length} (${summary})`, items.join("\n\n"));
  }

  function renderAssistant(
    m: AssistantMessage,
    t: string,
    results: Map<string, ToolResultMessage>,
  ): string {
    // Render blocks in their original chronological order: thinking always
    // precedes the text it produced, instead of being grouped after the fact.
    // Setext H1 (`===` underline): one level above the `##` headings AI
    // content typically starts with, and distinct from content `#` headings.
    const header = messageHeader("Assistant", [t, m.model].filter(Boolean).join(" · "));
    const parts: string[] = [];
    const thinkings: string[] = [];
    const flushThinking = () => {
      if (thinkings.length) {
        parts.push(callout("tldr", "Thinking", thinkings.join("\n\n")));
        thinkings.length = 0;
      }
    };
    const calls: RenderedToolCall[] = [];
    for (const b of m.content) {
      if (b.type === "text") {
        flushThinking();
        parts.push(b.text);
      } else if (b.type === "thinking") {
        thinkings.push(repairThinking(b.thinking));
      } else if (b.type === "toolCall") {
        flushThinking();
        const r = results.get(b.id);
        results.delete(b.id);
        calls.push({
          name: b.name,
          args: renderArgs(b.arguments),
          result: r ? resultText(r) : null,
          error: r ? r.isError : false,
        });
      }
    }
    flushThinking();
    if (calls.length) parts.push(renderToolCallsCallout(calls));
    if (m.errorMessage) parts.push(`> Error: ${m.errorMessage.replace(/\s+/g, " ").trim()}`);
    if (parts.length === 0) parts.push("_(empty response)_");
    return `${header}\n\n${parts.join("\n\n")}`;
  }

  /** Render a chronological list of message entries as markdown blocks. */
  function renderEntries(entries: SessionMessageEntry[]): string {
    // Tool calls sit in assistant entries while their results are separate
    // toolResult entries, paired by toolCall id. Collect results first so
    // each assistant block can fold its calls together with their results;
    // results left unclaimed (their call was saved in an earlier file, e.g.
    // a mid-turn manual save) render as standalone blocks.
    const results = new Map<string, ToolResultMessage>();
    for (const e of entries) {
      if (e.message.role === "toolResult") results.set(e.message.toolCallId, e.message);
    }

    const blocks: string[] = [];
    for (const e of entries) {
      const m = e.message;
      const t = dateTime(e.timestamp);
      if (m.role === "user") {
        blocks.push(`${messageHeader("User", t)}\n\n${renderUserMessageText(userText(m.content))}`);
      } else if (m.role === "assistant") {
        blocks.push(renderAssistant(m, t, results));
      } else if (m.role === "toolResult") {
        // Claimed results (deleted from the map by their assistant block)
        // were already folded inline; the rest have no call in this file.
        if (!results.has(m.toolCallId)) continue;
        blocks.push(renderToolResult(m));
      }
      // Other roles (custom, bashExecution, branchSummary, compactionSummary)
      // are not part of the rendered conversation record.
    }
    if (blocks.length === 0) return "";
    // Every block ends with a `---` separator wrapped in single blank lines
    // (the blank line above also keeps `---` from turning the last content
    // line into a setext H2). The trailing separator after the final block
    // makes later appends uniform: new blocks simply continue after it.
    return `${blocks.map(tighten).join("\n\n---\n\n")}\n\n---\n`;
  }

  // ---------- frontmatter ----------

  function yamlQuote(s: string): string {
    const safe = s.replace(/[\r\n]+/g, " ");
    return `"${safe.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }

  /**
   * ISO 8601 timestamp in the machine's local timezone, with the numeric
   * UTC offset appended (e.g. "2026-08-29T13:05:12+08:00"): tz-aware, so the
   * value reads as local wall-clock time without assuming the reader's
   * timezone. Legacy files written with UTC "Z" values parse identically.
   */
  function localIsoTimestamp(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    const offsetMin = -date.getTimezoneOffset();
    const sign = offsetMin >= 0 ? "+" : "-";
    const abs = Math.abs(offsetMin);
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
      `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
    );
  }

  function frontmatter(meta: BranchMeta): string {
    const lines: string[] = ["---"];
    lines.push(`title: ${yamlQuote(meta.title)}`);
    lines.push(`agent: ${yamlQuote(meta.agent)}`);
    lines.push(`format_version: ${yamlQuote(FORMAT_VERSION)}`);
    if (meta.sessionId) lines.push(`session_id: ${yamlQuote(meta.sessionId)}`);
    lines.push(`session_key: ${yamlQuote(meta.sessionKey)}`);
    lines.push(`branch_last_entry_id: ${yamlQuote(meta.branchLastEntryId)}`);
    if (meta.model) lines.push(`model: ${yamlQuote(meta.model)}`);
    if (meta.provider) lines.push(`provider: ${yamlQuote(meta.provider)}`);
    lines.push(`cost: ${meta.cost.toFixed(6)}`);
    // `tokens` counts everything billed, including cached tokens, so it is
    // comparable with provider-side token totals (e.g. OpenRouter activity).
    lines.push(
      `tokens: ${meta.tokensInput + meta.tokensOutput + meta.tokensCacheRead + meta.tokensCacheWrite}`,
    );
    lines.push(`tokens_input: ${meta.tokensInput}`);
    lines.push(`tokens_output: ${meta.tokensOutput}`);
    lines.push(`tokens_cache_read: ${meta.tokensCacheRead}`);
    lines.push(`tokens_cache_write: ${meta.tokensCacheWrite}`);
    lines.push(`messages: ${meta.messages}`);
    lines.push(`created: ${yamlQuote(meta.created)}`);
    lines.push(`updated: ${yamlQuote(meta.updated)}`);
    lines.push(`project_root: ${yamlQuote(meta.projectRoot)}`);
    if (meta.sessionFile) lines.push(`session_file: ${yamlQuote(meta.sessionFile)}`);
    lines.push("---");
    return lines.join("\n");
  }

  /** Recover the `messages` count from an existing frontmatter block. */
  function parseMessageCount(content: string): number | null {
    const m = content.match(/^messages: (\d+)$/m);
    return m ? Number(m[1]) : null;
  }

  /** Recover the original creation timestamp from an existing frontmatter block. */
  function parseCreated(content: string): string | undefined {
    const m = content.match(/^created: "(.*)"$/m);
    if (!m) return undefined;
    const iso = m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    return Number.isNaN(Date.parse(iso)) ? undefined : iso;
  }

  /** Recover the generator identity from an existing frontmatter block. */
  function parseAgent(content: string): string | undefined {
    const m = content.match(/^agent: "(.*)"$/m);
    if (!m) return undefined;
    const agent = m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\").trim();
    return agent || undefined;
  }

  function computeMeta(
    ctx: SaveContext,
    pathMessages: SessionMessageEntry[],
    sessionKey: string,
    created: string | undefined,
    agent: string | undefined,
  ): BranchMeta {
    let model: string | null = null;
    let provider: string | null = null;
    let cost = 0;
    let tokensInput = 0;
    let tokensOutput = 0;
    let tokensCacheRead = 0;
    let tokensCacheWrite = 0;
    for (const e of pathMessages) {
      const m = e.message;
      const usage = m.role === "assistant" ? m.usage : m.role === "toolResult" ? m.usage : null;
      if (m.role === "assistant") {
        model = m.model;
        provider = m.provider;
      }
      if (usage) {
        cost += usage.cost?.total ?? 0;
        tokensInput += usage.input ?? 0;
        tokensOutput += usage.output ?? 0;
        tokensCacheRead += usage.cacheRead ?? 0;
        tokensCacheWrite += usage.cacheWrite ?? 0;
      }
    }
    const now = localIsoTimestamp(new Date());
    return {
      title: displayTitle(ctx, firstUserText(pathMessages)),
      agent: agent ?? AGENT,
      sessionId: ctx.session.getSessionId(),
      sessionFile: ctx.session.getSessionFile() ?? null,
      sessionKey,
      branchLastEntryId: pathMessages[pathMessages.length - 1].id,
      model,
      provider,
      cost,
      tokensInput,
      tokensOutput,
      tokensCacheRead,
      tokensCacheWrite,
      messages: pathMessages.length,
      created: created ?? now,
      updated: now,
      projectRoot: ctx.cwd,
    };
  }

  // ---------- save planning ----------

  interface SavePlan {
    dir: string;
    filename: string;
    sessionKey: string;
    /** Write the full branch content (new branch, or target file missing). */
    fullCreate: boolean;
    /** Entries to append when continuing an existing file. */
    appendEntries: SessionMessageEntry[];
    /** Full root→leaf message list of the current branch (for meta/full renders). */
    pathMessages: SessionMessageEntry[];
    /** State of the file being continued, when not a full create. */
    state: SaveState | null;
    /** Set when resolvePlan deviated from the newest state (downgrade, fresh full save). */
    recoveryReason: string | null;
    /**
     * Rename-on-title: bare filename to move the file to after this save's
     * write (the file was created with the fallback slug and the session now
     * has its real name). Null when no rename is due.
     */
    renameTo: string | null;
    /**
     * Whether the file counts as properly named — recorded in the state
     * entry so a fallback-created file is renamed at most once.
     */
    titled: boolean;
    /**
     * Branch-change notice: the previous branch's file that stays on disk,
     * when this plan is a fresh file because recorded states exist but none
     * lies on the current path (a brand-new session has no states at all).
     */
    switchedFrom: string | null;
  }

  /** One on-path save state ranked for the continuation candidate chain. */
  interface StateCandidate {
    state: SaveState;
    /** Index of the state's lastSavedEntryId on the current path. */
    pos: number;
    /** Scan order (append order = record order); the later record wins ties. */
    order: number;
  }

  /** Pre-resolution save decision: everything needed to rank and validate candidates. */
  interface SavePlanInput {
    dir: string;
    pathMessages: SessionMessageEntry[];
    /** entryId → index in the current path, for candidate positions and appends. */
    pos: Map<string, number>;
    /** On-path candidates ranked by position desc, then record order desc. */
    candidates: StateCandidate[];
    /**
     * Latest recorded state that is NOT on the current path, when any state
     * exists: a fresh file with no candidates is a branch change (info
     * notice naming this state's file), not a brand-new session.
     */
    offPathState: SaveState | null;
  }

  /** Brand-new file plan for the current branch (new branch, or recovery). */
  function freshFilePlan(
    ctx: SaveContext,
    dir: string,
    pathMessages: SessionMessageEntry[],
  ): SavePlan {
    // Session-key scheme: the filename key is the first 8 hex of the SHA-256
    // of the session id — stable per session, so every file of one session
    // clusters together across recoveries and resumes. Never truncate the id
    // itself: pi session ids are uuidv7 whose leading hex is a millisecond
    // timestamp, so same-month sessions share long prefixes. When no session
    // id exists yet — the degenerate fallback — the deepest message entry's
    // id is hashed the same way, so the key is always an opaque 8-hex cluster
    // key, never a raw entry id.
    const sessionId = ctx.session.getSessionId();
    const sessionKey = createHash("sha256")
      .update(sessionId ?? pathMessages[pathMessages.length - 1].id)
      .digest("hex")
      .slice(0, 8);
    const title = titleForFilename(ctx, firstUserText(pathMessages));
    const filename = `${title}-${sessionKey}-${fileTimestamp(new Date())}.md`;
    debug("new branch file:", filename, "sessionKey:", sessionKey);
    return {
      dir,
      filename,
      sessionKey,
      fullCreate: true,
      appendEntries: [],
      pathMessages,
      state: null,
      recoveryReason: null,
      renameTo: null,
      switchedFrom: null,
      // A fresh file created under the session's real name is born titled;
      // one created under the fallback slug stays renameable until a real
      // name arrives.
      titled: Boolean(ctx.session.getSessionName()?.trim()),
    };
  }

  /**
   * Read every save-state entry of this session straight from the session
   * jsonl on disk. The append log is the single source of truth shared by all
   * runtimes, so a warm process whose in-memory tree lags behind still sees
   * states recorded by other runtimes — the stale-tree incident's root cause.
   * The full file is read once per save and each line passes a substring
   * pre-check before JSON.parse (grep level: only the handful of matching
   * lines are parsed), and corrupt / mid-write lines are skipped so a
   * concurrent append cannot poison the scan. Returns null when the disk
   * state is unavailable (no session file yet, or unreadable) — callers then
   * fall back to the in-memory tree scan.
   */
  async function readDiskSaveStates(sessionFile: string | null): Promise<SaveState[] | null> {
    if (!sessionFile) return null;
    let text: string;
    try {
      text = await fs.readFile(sessionFile, "utf-8");
    } catch (e) {
      debug("cannot read session file for state discovery — falling back to memory:", String(e));
      return null;
    }
    const started = Date.now();
    const states: SaveState[] = [];
    for (const line of text.split("\n")) {
      if (!line.includes(CUSTOM_TYPE)) continue;
      let entry: { type?: unknown; customType?: unknown; data?: unknown };
      try {
        entry = JSON.parse(line);
      } catch {
        continue; // skip corrupt / mid-write lines
      }
      if (entry.type === "custom" && entry.customType === CUSTOM_TYPE && isSaveState(entry.data)) {
        states.push(entry.data as SaveState);
      }
    }
    debug("disk state scan:", states.length, "states in", Date.now() - started, "ms");
    return states;
  }

  /**
   * Decide which file the current branch belongs to and what to write.
   *
   * Every save appends a custom entry recording {sessionKey, lastSavedEntryId,
   * file, schema}. Those entries live in the session tree, so a branch's own
   * latest state is always recoverable — including after resume, /tree
   * navigation, or /fork. State discovery is disk-first (see
   * readDiskSaveStates); the in-memory tree is only a fallback when the
   * session file is unavailable.
   *
   * ALL recorded states are considered — keeping only the latest state per
   * file could shadow an on-path state with one recorded on a different
   * branch, forcing needless new files. Every state whose saved position
   * still lies on the current root→leaf path becomes a continuation
   * candidate, ranked deepest position first. Ties on position (several
   * states recording the same lastSavedEntryId with different files — after
   * a loss recovery, a title rename) go to the state recorded LAST: scan
   * order is append order, and the newest record names the file the latest
   * successful save actually wrote, while older ones name superseded or dead
   * files. When the tree moved (navigation + re-ask), no position matches and
   * resolvePlan starts a new file; states existing but none matching means
   * a branch change, and the fresh file then carries the previous branch's
   * file as a notice (switchedFrom).
   *
   * Positions are resolved against THIS process's view of the current path:
   * a state recorded by another runtime on a genuinely diverged branch never
   * matches, so it correctly does not take over this branch's file (one
   * branch, one file).
   */
  async function computePlan(ctx: SaveContext): Promise<SavePlanInput | null> {
    const pathEntries = ctx.session.getBranch();
    const pathMessages = pathEntries.filter(isMessageEntry);
    if (pathMessages.length === 0) return null;

    const pos = new Map<string, number>();
    pathEntries.forEach((e, i) => pos.set(e.id, i));

    let states = await ctx.readSaveStates();
    if (states === null) {
      states = [];
      for (const e of ctx.session.getEntries()) {
        if (e.type !== "custom" || e.customType !== CUSTOM_TYPE || !isSaveState(e.data)) continue;
        states.push(e.data);
      }
      debug("disk state unavailable — in-memory scan found", states.length, "states");
    }

    const candidates: StateCandidate[] = [];
    // Latest state not on the current path, in record (scan) order: when no
    // candidate matches, its file is the previous branch's file that stays on
    // disk — named in the branch-change info notice.
    let offPathState: SaveState | null = null;
    let order = 0;
    for (const st of states) {
      if (st.schema && isNewerSchemaVersion(st.schema, SAVE_STATE_SCHEMA)) {
        ctx.warnMixedVersion(st);
      }
      if (!st.lastSavedEntryId) {
        offPathState = st;
        continue;
      }
      const p = pos.get(st.lastSavedEntryId);
      if (p === undefined) {
        offPathState = st;
        continue;
      }
      candidates.push({ state: st, pos: p, order: order++ });
    }
    candidates.sort((a, b) => b.pos - a.pos || b.order - a.order);

    return { dir: targetDir(ctx), pathMessages, pos, candidates, offPathState };
  }

  // ---------- writing ----------

  async function atomicWrite(file: string, content: string): Promise<void> {
    const tmp = file + ".save-tmp";
    await fs.writeFile(tmp, content, "utf-8");
    await fs.rename(tmp, file);
  }

  /**
   * Claim a filename that does not exist yet, never overwriting: an existing
   * target falls back to -1, -2 … suffixes (POSIX fs.rename silently replaces
   * an existing file). Every name-taking write goes through this — both
   * rename-on-title targets and fresh full saves, where two runtimes
   * recovering the same lost file in the same second would otherwise mint
   * the same name and silently overwrite each other. Returns null when the
   * desired name and 99 suffixes are all taken.
   */
  async function claimFilename(dir: string, desired: string): Promise<string | null> {
    const stem = desired.replace(/\.md$/, "");
    let target = desired;
    for (let i = 1; ; i++) {
      const taken = await fs
        .access(path.join(dir, target))
        .then(() => true)
        .catch(() => false);
      if (!taken) return target;
      if (i > 99) {
        debug("cannot claim a filename — desired name and 99 suffixes exist:", desired);
        return null;
      }
      target = `${stem}-${i}.md`;
    }
  }

  function replaceFrontmatter(existing: string, fm: string): string {
    if (/^---\r?\n[\s\S]*?\r?\n---\r?\n/.test(existing)) {
      const rest = existing.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
      // Heal the old layout's blank line(s) between the frontmatter and the
      // document heading (new files write the heading directly after the
      // frontmatter). Only blank lines immediately followed by a `#` heading
      // at the very start of the body are stripped — anything the user
      // reorganized stays untouched.
      const healed = rest.replace(/^(?:[ \t]*\r?\n)+(#[^\r\n]*)/, "$1");
      return fm + "\n" + healed;
    }
    return `${fm}\n\n${existing}`;
  }

  /**
   * Rewrite the document heading (the `# title` line written at file
   * creation) to the current title. Only called on rename-on-title saves.
   * The heading is located as the first non-blank line after the frontmatter
   * closing delimiter — new files write it directly after the frontmatter
   * with no blank line, legacy files wrote exactly one blank line before it
   * (replaceFrontmatter heals that away on appends) — rather than "the
   * first # line anywhere", so a manually deleted heading (whose place
   * would otherwise be taken by some content heading further down) cannot
   * be mis-rewritten.
   */
  function rewriteDocumentHeading(content: string, title: string): string {
    const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(content);
    if (!fm) return content;
    const rest = content.slice(fm[0].length);
    // Blank lines between the frontmatter and the heading belong to the
    // layout, not the heading — keep them, replace only the heading line.
    const replaced = rest.replace(
      /^((?:[ \t]*\r?\n)*)#[^\r\n]*/,
      (blank: string, prefix: string) => `${prefix}# ${title.replace(/[\r\n]+/g, " ")}`,
    );
    if (replaced === rest) return content; // heading deleted by hand — leave it
    return fm[0] + replaced;
  }

  /**
   * Rename-on-title decision for a file being continued (PRD §9.4).
   *
   * A file created before the session had its real name carries the fallback
   * slug in its filename. Once the session name exists, the save renames it
   * exactly once:
   * - "Fallback-named" comes from the state entry's `titled` flag; legacy
   *   entries (written before the flag existed) are judged by recomputing
   *   the fallback slug from the first user message and comparing it against
   *   the actual filename segment — a manually organized filename therefore
   *   never matches and is left alone.
   * - The target keeps the ORIGINAL creation timestamp (`<name>-<key>-<ts>`
   *   with ts parsed from the old filename): the file's birthday stays
   *   honest, and the target is a deterministic function of the file's own
   *   identity, so concurrent or retried renames converge on one name.
   * - No rename while the session is still unnamed, when the name sanitizes
   *   to the current segment (no-op), or when the filename does not parse.
   */
  function planRenameOnTitle(
    ctx: SaveContext,
    state: SaveState,
    pathMessages: SessionMessageEntry[],
  ): { renameTo: string | null; titled: boolean } {
    const keySuffix = "-" + state.sessionKey;
    // The trailing group tolerates (and drops) the -1, -2 … suffixes that
    // claimFilename may have added, so a suffixed file keeps its rename
    // eligibility; the suffix is not carried into the deterministic target.
    const tsMatch = /-(\d{8}-\d{6})(?:-\d{1,2})?\.md$/.exec(state.file);
    const base = tsMatch !== null ? state.file.slice(0, tsMatch.index) : null;
    const hasSegments = base !== null && base.endsWith(keySuffix);
    const titleSegment = hasSegments ? base.slice(0, base.length - keySuffix.length) : null;

    const isFallbackNamed =
      state.titled !== undefined
        ? !state.titled
        : titleSegment !== null &&
          titleSegment === fallbackTitleForFilename(firstUserText(pathMessages));
    if (!isFallbackNamed) {
      // Already properly named, or a legacy file the user organized by hand:
      // never rename, and record it as titled.
      return { renameTo: null, titled: true };
    }

    const name = ctx.session.getSessionName()?.trim();
    if (!name) return { renameTo: null, titled: false };

    const newTitle = sanitizeFilenamePart(name);
    const ts = tsMatch?.[1];
    if (!newTitle || !ts || titleSegment === null || newTitle === titleSegment) {
      return { renameTo: null, titled: false };
    }
    const renameTo = `${newTitle}-${state.sessionKey}-${ts}.md`;
    debug("rename-on-title planned:", state.file, "→", renameTo);
    return { renameTo, titled: false };
  }

  /**
   * Pick the continuation from the ranked candidates: validate each
   * newest-first — the target file must exist AND its frontmatter `messages`
   * count must cover the messages already saved for this branch (path
   * messages minus the ones about to be appended; a count that exceeds it
   * is fine — a descendant branch extended the same file) — and keep the
   * FIRST candidate that passes.
   *
   * When the newest candidate fails but an older one validates, the save
   * downgrades to the older file and a recoveryReason warns about it: the
   * newest target failing is the anomaly worth surfacing (an external tool
   * moving files, or a concurrent rewrite), and silently converging onto the
   * older file would hide it. Only when EVERY candidate fails — deleted
   * files, or files rewritten from a different tree position (e.g. /tree
   * navigation plus a save on an older branch), where continuing could
   * silently strand this branch's newer messages — is a brand-new file with
   * the full current branch written, with a warning naming the newest target
   * and its failure. Both missing-target and count-mismatch failures are
   * distinguished in the warning text, since they point at different
   * causes (something moving/deleting files vs. a concurrent runtime or an
   * older extension version). No cap on the candidate walk: the usual case
   * passes on the first candidate (one read); the worst case is one read per
   * candidate, and cutting the chain short would break the
   * "fresh file only when everything failed" semantics.
   */
  async function resolvePlan(ctx: SaveContext, input: SavePlanInput): Promise<SavePlan> {
    if (input.candidates.length === 0) {
      const fresh = freshFilePlan(ctx, input.dir, input.pathMessages);
      // Recorded states exist but none lies on the current path: the tree
      // moved to a different branch (a brand-new session has no states at
      // all). Normal one-branch-one-file behavior — surfaced as info so the
      // earlier branch's kept file is not mistaken for this branch's file.
      fresh.switchedFrom = input.offPathState ? input.offPathState.file : null;
      return fresh;
    }

    // Failure of the newest candidate, recorded once for the downgrade /
    // fresh-file warnings: the newest target is the anomaly, later failures
    // only explain why the chain kept walking.
    let topFailure: {
      kind: "missing" | "count";
      file: string;
      saved: number | null;
      expected: number;
    } | null = null;

    for (let i = 0; i < input.candidates.length; i++) {
      const c = input.candidates[i];
      const appendEntries = input.pathMessages.filter((e) => (input.pos.get(e.id) ?? -1) > c.pos);
      const expected = input.pathMessages.length - appendEntries.length;
      const filePath = path.join(input.dir, c.state.file);
      const exists = await fs
        .access(filePath)
        .then(() => true)
        .catch(() => false);
      if (!exists) {
        debug("candidate #" + (i + 1), "missing on disk:", c.state.file);
        if (!topFailure) {
          topFailure = { kind: "missing", file: c.state.file, saved: null, expected };
        }
        continue;
      }
      const existing = await fs.readFile(filePath, "utf-8");
      const saved = parseMessageCount(existing);
      // The file holds this branch's prefix plus possibly a descendant
      // branch's extra messages (saved > expected with nothing new to
      // append): that is fine to keep. Missing messages (saved < expected,
      // or none readable), or extra messages that new appends would
      // interleave with, are not — both would silently strand messages.
      if (saved === null || saved < expected || (saved > expected && appendEntries.length > 0)) {
        debug(
          "candidate #" + (i + 1),
          "out of sync (messages:",
          saved,
          "expected:",
          expected,
          "):",
          c.state.file,
        );
        if (!topFailure) {
          topFailure = { kind: "count", file: c.state.file, saved, expected };
        }
        continue;
      }
      debug(
        "continuing branch file:",
        c.state.file,
        "saved-up-to:",
        c.state.lastSavedEntryId,
        "new entries:",
        appendEntries.length,
        "(candidate #" + (i + 1) + " of " + input.candidates.length + ")",
      );
      const rename = planRenameOnTitle(ctx, c.state, input.pathMessages);
      return {
        dir: input.dir,
        filename: c.state.file,
        sessionKey: c.state.sessionKey,
        fullCreate: false,
        appendEntries,
        pathMessages: input.pathMessages,
        state: c.state,
        renameTo: rename.renameTo,
        titled: rename.titled,
        switchedFrom: null,
        recoveryReason:
          topFailure === null
            ? null
            : topFailure.kind === "missing"
              ? `latest saved file "${topFailure.file}" is missing on disk — ` +
                `fell back to continuing "${c.state.file}" instead; ` +
                "check whether an external tool is moving or deleting files in the archive directory"
              : `latest saved file "${topFailure.file}" no longer matches this branch's saved messages ` +
                `(file holds ${topFailure.saved ?? "no readable count"}, expected ${topFailure.expected}) — ` +
                `fell back to continuing "${c.state.file}" instead; ` +
                "this usually means another runtime or an older extension version rewrote it",
      };
    }

    // Every candidate failed: fresh full-branch file, warning names the
    // newest target and its failure (both texts kept from the single-state
    // era — same causes, same wording).
    const fresh = freshFilePlan(ctx, input.dir, input.pathMessages);
    fresh.recoveryReason =
      topFailure === null
        ? null
        : topFailure.kind === "missing"
          ? `target file "${topFailure.file}" is missing on disk — the full branch was saved to a fresh file instead; ` +
            "check whether an external tool is moving or deleting files in the archive directory"
          : `target file "${topFailure.file}" no longer matches this branch's saved messages ` +
            `(file holds ${topFailure.saved ?? "no readable count"}, expected ${topFailure.expected}) — the full branch was saved to a fresh file instead; ` +
            "this usually means another runtime or an older extension version rewrote it";
    return fresh;
  }

  async function saveConversation(ctx: SaveContext, plan: SavePlan): Promise<SaveResult> {
    const filePath = path.join(plan.dir, plan.filename);

    await fs.mkdir(plan.dir, { recursive: true });

    if (plan.fullCreate) {
      // Never overwrite: two runtimes recovering the same lost file in the
      // same second mint the same name — claim a free one instead. The
      // claimed name is what the state entry records (recordState below).
      const claimed = await claimFilename(plan.dir, plan.filename);
      if (claimed === null) {
        throw new Error(
          `cannot create a fresh save — "${plan.filename}" and 99 suffixes all exist`,
        );
      }
      plan.filename = claimed;
      const target = path.join(plan.dir, plan.filename);
      const meta = computeMeta(ctx, plan.pathMessages, plan.sessionKey, undefined, undefined);
      const body = renderEntries(plan.pathMessages); // ends with the trailing separator
      const content = `${frontmatter(meta)}\n# ${meta.title}\n\n${body}`;
      await atomicWrite(target, content);
      debug("created conversation file:", target);
      return {
        message: `saved ${plan.filename} (${plan.pathMessages.length} messages)`,
        wrote: true,
        created: true,
        file: target,
        recovered: plan.recoveryReason,
        switchedFrom: plan.switchedFrom,
        renamed: false,
      };
    }

    if (plan.appendEntries.length === 0 && !plan.renameTo) {
      debug("nothing new since last save:", plan.filename);
      return {
        message: `already up to date (${plan.filename})`,
        wrote: false,
        created: false,
        file: filePath,
        // A downgrade warning (candidate chain fell back to this file) must
        // surface even when there is nothing new to append.
        recovered: plan.recoveryReason,
        switchedFrom: null,
        renamed: false,
      };
    }

    const existing = await fs.readFile(filePath, "utf-8");
    const meta = computeMeta(
      ctx,
      plan.pathMessages,
      plan.sessionKey,
      parseCreated(existing),
      parseAgent(existing),
    );
    let updated = replaceFrontmatter(existing, frontmatter(meta));
    // Rename-on-title: rewrite the document heading to the now-real title
    // (the frontmatter title is refreshed above) while still writing under
    // the old name — the move itself happens after this write. A rename due
    // with nothing new to append is still a write: the title fields change,
    // and the state entry must carry the new name.
    if (plan.renameTo) updated = rewriteDocumentHeading(updated, meta.title);
    if (plan.appendEntries.length > 0) {
      const appended = renderEntries(plan.appendEntries); // ends with the trailing separator
      // Collapse trailing blank lines to a single newline so the separator
      // always has exactly one blank line above it, whatever earlier saves
      // (or a manual edit) left behind.
      updated = updated.replace(/\s*$/, "\n");
      // Files written by the old format end without a `---` separator; add one
      // at the boundary so old and new content stay delimited.
      updated += updated.endsWith("---\n") ? `\n${appended}` : `\n---\n\n${appended}`;
    }
    await atomicWrite(filePath, updated);
    debug("appended", plan.appendEntries.length, "entries to:", filePath);
    return {
      message:
        plan.appendEntries.length > 0
          ? `appended ${plan.appendEntries.length} messages to ${plan.filename}`
          : `refreshed title of ${plan.filename}`,
      wrote: true,
      created: false,
      file: filePath,
      // A downgrade warning (candidate chain fell back to this file) must
      // surface on the append that performed the downgrade.
      recovered: plan.recoveryReason,
      switchedFrom: null,
      renamed: false,
    };
  }

  function relativeForUser(ctx: SaveContext, file: string): string {
    const rel = path.relative(ctx.cwd, file);
    return rel && !rel.startsWith("..") ? rel : file;
  }

  // Serialize saves: agent_settled and the manual command must not interleave.
  let chain: Promise<unknown> = Promise.resolve();
  function schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Move the just-written file to its rename-on-title target (PRD §9.4
   * D5'/D7'/D8'). Runs AFTER the write, so a failed write never orphans a
   * renamed file; a failed rename keeps the old filename (the title fields
   * were already fixed in the write) and leaves titled=false, so the next
   * save retries — the target is deterministic, so retries converge on one
   * name. The move never overwrites: POSIX fs.rename silently replaces an
   * existing target, so an existing one falls back to -1, -2 … suffixes.
   */
  async function applyRename(ctx: SaveContext, plan: SavePlan, result: SaveResult): Promise<void> {
    if (!plan.renameTo) return;
    const target = await claimFilename(plan.dir, plan.renameTo);
    if (target === null) {
      debug("rename-on-title gave up — target and 99 suffixes exist:", plan.renameTo);
      return;
    }
    try {
      await fs.rename(path.join(plan.dir, plan.filename), path.join(plan.dir, target));
    } catch (e) {
      debug("rename-on-title failed — kept old filename, retrying next save:", String(e));
      return;
    }
    debug("renamed branch file:", plan.filename, "→", target);
    plan.filename = target;
    plan.titled = true;
    result.file = path.join(plan.dir, target);
    result.renamed = true;
    ctx.notify(`${NOTIFY_TAG} renamed to ${relativeForUser(ctx, result.file)}`, "info");
  }

  /** Full save cycle: write the file, then persist the branch state entry. */
  async function runSave(ctx: SaveContext): Promise<SaveResult> {
    const input = await computePlan(ctx);
    if (!input) {
      return {
        message: "no conversation content to save yet",
        wrote: false,
        created: false,
        file: null,
        recovered: null,
        switchedFrom: null,
        renamed: false,
      };
    }
    const plan = await resolvePlan(ctx, input);
    // Concurrency guard for disk-backed sessions: bail before ANY write when
    // the foreign jsonl moved since load. No-op for the live session.
    await ctx.beforeWrite();
    const result = await saveConversation(ctx, plan);
    if (result.wrote) {
      await applyRename(ctx, plan, result);
      const leafId = ctx.session.getLeafId();
      await ctx.appendState({
        sessionKey: plan.sessionKey,
        lastSavedEntryId: leafId,
        file: plan.filename,
        schema: SAVE_STATE_SCHEMA,
        extVersion: EXTENSION_VERSION ?? undefined,
        titled: plan.titled,
      });
      debug("recorded state entry — sessionKey:", plan.sessionKey, "leaf:", leafId);
    }
    return result;
  }

  /**
   * Wrap the real host context as a SaveContext for the live session. The
   * session surface passes straight through (structural subset), state
   * entries go through pi.appendEntry, and the mixed-version warning keeps
   * its per-process latch for the live path.
   */
  function liveContext(ctx: ExtensionContext): SaveContext {
    return {
      cwd: ctx.cwd,
      hasUI: ctx.hasUI,
      notify: (message, level) => {
        if (ctx.hasUI) ctx.ui.notify(message, level);
      },
      session: ctx.sessionManager,
      readSaveStates: () => readDiskSaveStates(ctx.sessionManager.getSessionFile() ?? null),
      warnMixedVersion: (st) => {
        // One mixed-version warning per process: repeating it every turn
        // would only train the user to ignore it. Headless runs (no UI)
        // count as warned too — there is no notification surface to wait for.
        if (mixedVersionWarned) return;
        mixedVersionWarned = true;
        const writer = st.extVersion
          ? `extension v${st.extVersion} (save-state schema ${st.schema})`
          : `save-state schema ${st.schema}`;
        debug(
          "mixed versions: state entries written by",
          writer,
          "— this code is",
          SAVE_STATE_SCHEMA,
        );
        if (ctx.hasUI) {
          ctx.ui.notify(
            `${NOTIFY_TAG} this session was written to by a newer ${writer}, while this process runs older code — restart the session / reload Pi to load the new version`,
            "warning",
          );
        }
      },
      beforeWrite: async () => {},
      appendState: async (state) => {
        pi.appendEntry(CUSTOM_TYPE, state);
      },
    };
  }

  // The live path's mixed-version latch (see liveContext).
  let mixedVersionWarned = false;

  // 1. Automatic: save after every settled agent turn.
  pi.on("agent_settled", async (_event: AgentSettledEvent, ctx: ExtensionContext) => {
    // Non-persisted sessions (in-memory, `--no-session`) are ephemeral
    // auxiliary agents — see the skip rule in the header. The manual
    // /save-conversation command below is the explicit-demand escape hatch.
    if (!ctx.sessionManager.getSessionFile()) {
      debug(
        "agent_settled — session has no session file (in-memory / --no-session); skipping auto-save",
      );
      return;
    }
    debug("agent_settled — saving conversation");
    try {
      const live = liveContext(ctx);
      const r = await schedule(() => runSave(live));
      // A recovery replaces the routine "created" info: the anomaly is the
      // story worth telling, at a level that distinguishes it (warning).
      if (r.recovered && ctx.hasUI && r.file) {
        ctx.ui.notify(`${NOTIFY_TAG} ${r.recovered} → ${relativeForUser(live, r.file)}`, "warning");
      } else if (r.wrote && r.created && ctx.hasUI && r.file) {
        if (r.switchedFrom) {
          ctx.ui.notify(
            `${NOTIFY_TAG} branch changed — new branch file ${relativeForUser(live, r.file)}; the earlier branch file ${r.switchedFrom} is kept`,
            "info",
          );
        } else {
          ctx.ui.notify(`${NOTIFY_TAG} ${relativeForUser(live, r.file)}`, "info");
        }
      }
    } catch (e) {
      debug("auto-save failed:", String(e));
      if (ctx.hasUI) ctx.ui.notify(`${NOTIFY_TAG} save failed: ${String(e)}`, "error");
    }
  });

  // 2. Manual: force a save now and report where it went.
  pi.registerCommand(COMMAND, {
    description:
      "Save the current conversation branch to a markdown file now (pi-auto-save-to-markdown)",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      try {
        debug("manual /" + COMMAND + " invoked");
        const live = liveContext(ctx);
        const r = await schedule(() => runSave(live));
        if (ctx.hasUI) {
          const target = r.file ? relativeForUser(live, r.file) : "";
          ctx.ui.notify(`${NOTIFY_TAG} ${r.message}${target ? ` → ${target}` : ""}`, "info");
          if (r.recovered && r.file) {
            ctx.ui.notify(`${NOTIFY_TAG} ${r.recovered} → ${target}`, "warning");
          }
          if (r.switchedFrom && r.file) {
            ctx.ui.notify(
              `${NOTIFY_TAG} branch changed — new branch file ${target}; the earlier branch file ${r.switchedFrom} is kept`,
              "info",
            );
          }
        }
      } catch (e) {
        debug("/" + COMMAND + " failed:", String(e));
        if (ctx.hasUI) ctx.ui.notify(`${NOTIFY_TAG} save failed: ${String(e)}`, "error");
      }
    },
  });

  // 3. Batch: save every session of this project (PRD §5 P3 + §9.6).
  async function saveAllSessions(ctx: ExtensionContext): Promise<void> {
    const started = Date.now();
    const live = liveContext(ctx);
    let saved = 0;
    let freshCreated = 0;
    let renamed = 0;
    let switched = 0;
    let upToDate = 0;
    let skippedEmpty = 0;
    let skippedLegacy = 0;
    let deferred = 0;
    const failed: string[] = [];

    const count = (r: SaveResult) => {
      if (r.wrote) {
        saved++;
        if (r.created) freshCreated++;
        if (r.renamed) renamed++;
        if (r.switchedFrom) switched++;
      } else {
        upToDate++;
      }
    };

    // The live session first, through the normal path: its in-memory tree may
    // be fresher than disk, and its state entry goes through pi.appendEntry.
    // A non-persisted current session (in-memory / --no-session) is skipped —
    // see the skip rule in the header.
    if (!ctx.sessionManager.getSessionFile()) {
      debug(
        "/" + COMMAND_ALL + " — current session not persisted (in-memory / --no-session); skipped",
      );
    } else {
      try {
        const r = await runSave(live);
        count(r);
        if (ctx.hasUI) {
          const target = r.file ? relativeForUser(live, r.file) : "";
          ctx.ui.notify(`${NOTIFY_TAG} ${r.message}${target ? ` → ${target}` : ""}`, "info");
          if (r.recovered && r.file) {
            ctx.ui.notify(`${NOTIFY_TAG} ${r.recovered} → ${target}`, "warning");
          }
          if (r.switchedFrom && r.file) {
            ctx.ui.notify(
              `${NOTIFY_TAG} branch changed — new branch file ${target}; the earlier branch file ${r.switchedFrom} is kept`,
              "info",
            );
          }
        }
      } catch (e) {
        failed.push("<current session>");
        debug("/" + COMMAND_ALL + " live save failed:", String(e));
        if (ctx.hasUI) {
          ctx.ui.notify(`${NOTIFY_TAG} save failed: ${String(e)}`, "error");
        }
      }
    }

    // The project's sessions directory — every session jsonl lives there.
    const currentFile = ctx.sessionManager.getSessionFile();
    const dir = currentFile ? path.dirname(currentFile) : defaultSessionsDir(ctx.cwd);
    const currentId = ctx.sessionManager.getSessionId();
    const files: { file: string; mtime: number }[] = [];
    try {
      const names = (await fs.readdir(dir)).filter((f) => f.endsWith(".jsonl"));
      for (const name of names) {
        const file = path.join(dir, name);
        try {
          files.push({ file, mtime: (await fs.stat(file)).mtimeMs });
        } catch {
          // vanished between readdir and stat — the mover; ignore
        }
      }
    } catch (e) {
      debug("/" + COMMAND_ALL + " cannot list sessions dir:", String(e));
      if (ctx.hasUI) {
        ctx.ui.notify(`${NOTIFY_TAG} cannot list sessions directory: ${String(e)}`, "error");
      }
      return;
    }
    // Newest first: if the run is interrupted, the most recent sessions are done.
    files.sort((a, b) => b.mtime - a.mtime);

    const sink = (message: string, level: "info" | "warning" | "error") => {
      if (ctx.hasUI) ctx.ui.notify(`${NOTIFY_TAG} ${message}`, level);
    };

    for (const { file } of files) {
      if (currentFile && path.resolve(file) === path.resolve(currentFile)) continue;
      try {
        const outcome = await loadDiskSession(file, sink);
        if (outcome.kind === "deferred") {
          deferred++;
          continue;
        }
        if (outcome.kind === "skip") {
          if (outcome.reason === "legacy") skippedLegacy++;
          else skippedEmpty++;
          continue;
        }
        if (outcome.view.session.getSessionId() === currentId) continue; // same session, other file
        const view = outcome.view;
        const r = await runSave(view);
        count(r);
        // Recovery warnings are anomalies — shown per session, tagged.
        if (r.recovered && r.file && ctx.hasUI) {
          ctx.ui.notify(
            `${NOTIFY_TAG} [${view.tag()}] ${r.recovered} → ${relativeForUser(live, r.file)}`,
            "warning",
          );
        }
      } catch (e) {
        if (e instanceof SessionChangedError) {
          deferred++;
          continue;
        }
        failed.push(path.basename(file));
        debug("/" + COMMAND_ALL + " session failed:", path.basename(file), String(e));
        if (ctx.hasUI) {
          ctx.ui.notify(
            `${NOTIFY_TAG} [${path.basename(file)}] save failed: ${String(e)}`,
            "error",
          );
        }
      }
    }

    const summaryParts = [
      `${saved} saved`,
      `${upToDate} up to date`,
      `${skippedEmpty + skippedLegacy} skipped`,
    ];
    if (saved && (freshCreated || renamed || switched)) {
      const detail = [
        freshCreated ? `${freshCreated} new` : "",
        renamed ? `${renamed} renamed` : "",
        switched ? `${switched} branch switches` : "",
      ]
        .filter(Boolean)
        .join(", ");
      if (detail) summaryParts[0] += ` (${detail})`;
    }
    if (skippedEmpty + skippedLegacy) {
      summaryParts[2] += skippedLegacy
        ? ` (${skippedEmpty} without assistant reply, ${skippedLegacy} legacy)`
        : " (no assistant reply)";
    }
    if (deferred)
      summaryParts.push(`${deferred} deferred (changed while saving — next run continues them)`);
    summaryParts.push(`${failed.length} failed`);
    if (failed.length) {
      const shown = failed.slice(0, 5).join(", ");
      summaryParts.push(`: ${shown}${failed.length > 5 ? " …" : ""}`);
    }
    debug("/" + COMMAND_ALL + " finished in", Date.now() - started, "ms");
    if (ctx.hasUI) {
      ctx.ui.notify(`${NOTIFY_TAG} /${COMMAND_ALL}: ${summaryParts.join(", ")}`, "info");
    }
  }

  pi.registerCommand(COMMAND_ALL, {
    description:
      "Save every session of this project to markdown files now (pi-auto-save-to-markdown)",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      try {
        debug("manual /" + COMMAND_ALL + " invoked");
        // The whole batch is serialized against auto-saves and the manual
        // /save-conversation: same queue, no interleaved claims.
        await schedule(() => saveAllSessions(ctx));
      } catch (e) {
        debug("/" + COMMAND_ALL + " failed:", String(e));
        if (ctx.hasUI) ctx.ui.notify(`${NOTIFY_TAG} save failed: ${String(e)}`, "error");
      }
    },
  });
}

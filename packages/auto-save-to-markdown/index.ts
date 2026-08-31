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
 * - Location: a subfolder of the session's working directory (`ctx.cwd`, the
 *   directory the session was started in), defaulting to `ai-conversations`.
 *   Override with the PI_SAVE_CONVERSATION_DIR environment variable; set it to
 *   "." or "" to save directly into the working directory.
 * - Filename: `<title>-<tree>-<time>.md`, where <title> is the session name
 *   (or a slug of the first user message when unnamed), <tree> is the 8-hex id
 *   of the deepest message entry at file creation, and <time> is the local
 *   file-creation timestamp (YYYYMMDD-HHmmss).
 * - Frontmatter: title, agent (generator identity, always "pi" here — agent
 *   plugins for other runtimes would write their own value), session id, tree
 *   (branch key), model, provider, cumulative cost and tokens (input, output,
 *   cache read/write), message count, created/updated timestamps, project
 *   root and session file.
 * - Body format: every message block opens with a setext-H1 info header
 *   (`User <span …>YYYY-MM-DD HH:MM:SS</span>` /
 *   `Assistant <span …>YYYY-MM-DD HH:MM:SS · model</span>`, where the span
 *   renders the metadata as small faint text — Obsidian CSS variables, so it
 *   degrades gracefully elsewhere — underlined with `===`, distinct from the
 *   `#`/`##` ATX headings AI content uses) and ends with a `---` separator
 *   wrapped in single blank lines.
 * - Tool call/result folding: calls live in the assistant entry while their
 *   results are separate toolResult entries; saves pair them by toolCall id
 *   and fold each assistant block's calls, with a short result preview each,
 *   into one collapsed Obsidian callout (`> [!quote]- Tool Calls · …`).
 *   Thinking folds the same way into `> [!tldr]- Thinking`. Callouts are used
 *   instead of HTML `<details>` because Obsidian's views render embedded
 *   markdown inside HTML blocks unreliably, while callouts fold and render
 *   markdown in both Live Preview and Reading view. Outside Obsidian the
 *   callouts degrade to plain blockquotes. Argument previews and result
 *   previews are wrapped in inline code spans (delimiter sized to survive
 *   backticks inside the content), so raw output renders literally instead
 *   of being parsed as markdown. A result whose call was saved in
 *   an earlier file (mid-turn manual save) falls back to a standalone
 *   one-line block.
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
 *   matches and a new file is created with the full current branch. Continuing
 *   an existing branch appends only the messages that are new since the last
 *   save.
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
 *   older extension version for a count mismatch). Every branch therefore
 *   always ends up with a complete, consistent file.
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
 *   re-joined into flowing text before saving; clean thinking is untouched.
 *
 * Manual command: `/save-conversation` saves the current branch immediately
 * and reports the file path.
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
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { debug } from "./debug.js";

const CUSTOM_TYPE = "pi-claudian-auto-save-markdown";
const ENV_SUBDIR = "PI_SAVE_CONVERSATION_DIR";
const DEFAULT_SUBDIR = "ai-conversations";
const COMMAND = "save-conversation";
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
const SAVE_STATE_SCHEMA = "1.0";

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
const TOOL_RESULT_PREVIEW = 500;
const TOOL_ARGS_PREVIEW = 160;

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
  branchKey: string;
  lastSavedEntryId: string | null;
  file: string;
  /** Save-state schema version ("MAJOR.MINOR") of the writer. */
  schema?: string;
  /** Package version of the writer, warning text only. */
  extVersion?: string;
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
    typeof s.branchKey === "string" &&
    s.branchKey.length > 0 &&
    (s.lastSavedEntryId === null || typeof s.lastSavedEntryId === "string") &&
    typeof s.file === "string" &&
    s.file.length > 0
  );
}

interface SaveResult {
  message: string;
  /** A file was actually written (created or appended). */
  wrote: boolean;
  /** The write created a brand-new file (vs appending to an existing one). */
  created: boolean;
  file: string | null;
  /** Why a planned continuation was replaced by a fresh full save, if it was. */
  recovered: string | null;
}

interface BranchMeta {
  title: string;
  /** Generator identity; preserved from the file being appended to. */
  agent: string;
  sessionId: string | null;
  sessionFile: string | null;
  tree: string;
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
 * Repair strips all newlines — run length carries no recoverable meaning (the
 * same paragraph boundary appears as 1, 2 or 3 newlines, while 4–7 can sit
 * mid-sentence) — and collapses the doubled spaces left by lone-space
 * fragments. Clean blocks pass through untouched.
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

/** Repair newline-fragmented thinking; clean thinking is returned unchanged. */
function repairThinking(s: string): string {
  if (!isFragmentedThinking(s)) return s;
  debug("repairing fragmented thinking block:", s.length, "chars");
  return s
    .replace(/\n+/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export default function (pi: ExtensionAPI) {
  /**
   * Resolve the target directory. The env var may hold a relative folder name
   * (resolved against the session cwd), an absolute path, or "." / "" for the
   * working directory itself. When unset, the default subfolder is used.
   */
  function targetDir(ctx: ExtensionContext): string {
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
      if (e.message.role === "user") return userText(e.message.content) || undefined;
    }
    return undefined;
  }

  /** Title for the filename: session name, else a slug of the first user message. */
  function titleForFilename(ctx: ExtensionContext, firstUser: string | undefined): string {
    const name = ctx.sessionManager.getSessionName()?.trim();
    if (name) return sanitizeFilenamePart(name) || "untitled";
    if (firstUser) {
      const slug = sanitizeFilenamePart(firstUser.slice(0, TITLE_FALLBACK_LENGTH));
      if (slug) return slug;
    }
    return "untitled";
  }

  /** Title for the frontmatter / document heading. */
  function displayTitle(ctx: ExtensionContext, firstUser: string | undefined): string {
    const name = ctx.sessionManager.getSessionName()?.trim();
    if (name) return name;
    if (firstUser) {
      const snippet = firstUser.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_LENGTH);
      if (snippet) return snippet;
    }
    return "untitled";
  }

  function previewArgs(args: unknown): string {
    let s: string;
    try {
      s = JSON.stringify(args) ?? "";
    } catch {
      s = String(args);
    }
    s = s.replace(/\s+/g, " ").trim();
    return s.length > TOOL_ARGS_PREVIEW ? s.slice(0, TOOL_ARGS_PREVIEW) + " …" : s;
  }

  // ---------- markdown rendering ----------

  /**
   * Inline code span for arbitrary raw output (tool results, argument JSON):
   * the delimiter is always one backtick longer than the longest backtick run
   * inside the text, so content that itself contains backticks cannot break
   * the span. Tool output renders literally instead of being parsed as
   * markdown (headings, bold, wiki links …).
   */
  function inlineCode(text: string): string {
    const longest = (text.match(/`+/g) ?? []).reduce((a, r) => Math.max(a, r.length), 0);
    const fence = "`".repeat(longest + 1);
    return `${fence}${text}${fence}`;
  }

  /**
   * Strip leading blank lines and trailing whitespace from a rendered block,
   * so joins and separators always keep exactly one blank line around them
   * no matter what blank lines the content itself starts or ends with.
   */
  function tighten(s: string): string {
    return s.replace(/^(?:[ \t]*\n)+/, "").replace(/\s+$/, "");
  }

  /** One tool call with its paired result preview (null when no result entry exists). */
  interface RenderedToolCall {
    name: string;
    args: string;
    result: string | null;
  }

  /** Flattened, length-capped result preview with error status suffix. */
  function resultPreview(m: ToolResultMessage): string {
    const texts: string[] = [];
    for (const b of m.content) {
      if (b.type === "text") texts.push(b.text);
      else texts.push(`_[image: ${b.mimeType}]_`);
    }
    const flat = texts.join(" ").replace(/\s+/g, " ").trim();
    const capped =
      flat.length > TOOL_RESULT_PREVIEW ? flat.slice(0, TOOL_RESULT_PREVIEW) + " …" : flat;
    const status = m.isError ? " (error)" : "";
    return `${capped}${status}`.trim();
  }

  /** Standalone one-line block for a result whose call is not in this file. */
  function renderToolResult(m: ToolResultMessage): string {
    return `> **Tool · ${m.toolName}** ${inlineCode(resultPreview(m))}`.trim();
  }

  /** "read, web_search ×2" — tool names with repeat counts, first-seen order. */
  function summarizeToolNames(names: string[]): string {
    const counts = new Map<string, number>();
    for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
    return [...counts].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(", ");
  }

  /**
   * Collapsed Obsidian callout (`> [!type]- title`) wrapping a markdown body:
   * every body line is prefixed with `>` (empty lines become bare `>`), so the
   * body keeps rendering as markdown while folding works in both Obsidian
   * views. Outside Obsidian the callout degrades to a plain blockquote.
   */
  function callout(type: string, title: string, body: string): string {
    const lines = body.split("\n").map((line) => (line ? `> ${line}` : ">"));
    return `> [!${type}]- ${title}\n${lines.join("\n")}`;
  }

  /**
   * Fold tool calls and their paired results into one collapsed callout.
   * Argument JSON and result previews are wrapped in inline code spans, so
   * raw output renders literally instead of being parsed as markdown.
   */
  function renderToolCallsCallout(calls: RenderedToolCall[]): string {
    const summary = summarizeToolNames(calls.map((c) => c.name));
    const items = calls.map((c) => {
      const head = c.args ? `**\`${c.name}\`** ${inlineCode(c.args)}` : `**\`${c.name}\`**`;
      const result =
        c.result === null ? "_(no result)_" : inlineCode(c.result || "_(empty result)_");
      return `${head}\n\n> ${result}`;
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
          args: previewArgs(b.arguments),
          result: r ? resultPreview(r) : null,
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
        blocks.push(`${messageHeader("User", t)}\n\n${userText(m.content)}`);
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

  function frontmatter(meta: BranchMeta): string {
    const lines: string[] = ["---"];
    lines.push(`title: ${yamlQuote(meta.title)}`);
    lines.push(`agent: ${yamlQuote(meta.agent)}`);
    if (meta.sessionId) lines.push(`session_id: ${yamlQuote(meta.sessionId)}`);
    lines.push(`tree: ${yamlQuote(meta.tree)}`);
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
    ctx: ExtensionContext,
    pathMessages: SessionMessageEntry[],
    branchKey: string,
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
    const now = new Date().toISOString();
    return {
      title: displayTitle(ctx, firstUserText(pathMessages)),
      agent: agent ?? AGENT,
      sessionId: ctx.sessionManager.getSessionId(),
      sessionFile: ctx.sessionManager.getSessionFile() ?? null,
      tree: branchKey,
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
    branchKey: string;
    /** Write the full branch content (new branch, or target file missing). */
    fullCreate: boolean;
    /** Entries to append when continuing an existing file. */
    appendEntries: SessionMessageEntry[];
    /** Full root→leaf message list of the current branch (for meta/full renders). */
    pathMessages: SessionMessageEntry[];
    /** State of the file being continued, when not a full create. */
    state: SaveState | null;
    /** Set when resolvePlan replaced a continuation with a fresh full save. */
    recoveryReason: string | null;
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
  }

  function isMessageEntry(e: SessionEntry): e is SessionMessageEntry {
    return e.type === "message";
  }

  /** Brand-new file plan for the current branch (new branch, or recovery). */
  function freshFilePlan(
    ctx: ExtensionContext,
    dir: string,
    pathMessages: SessionMessageEntry[],
  ): SavePlan {
    const branchKey = pathMessages[pathMessages.length - 1].id;
    const title = titleForFilename(ctx, firstUserText(pathMessages));
    const filename = `${title}-${branchKey}-${fileTimestamp(new Date())}.md`;
    debug("new branch file:", filename, "branchKey:", branchKey);
    return {
      dir,
      filename,
      branchKey,
      fullCreate: true,
      appendEntries: [],
      pathMessages,
      state: null,
      recoveryReason: null,
    };
  }

  // One mixed-version warning per process: repeating it every turn would
  // only train the user to ignore it. Headless runs (no UI) count as warned
  // too — there is no notification surface to wait for.
  let mixedVersionWarned = false;

  function warnMixedVersions(ctx: ExtensionContext, st: SaveState): void {
    if (mixedVersionWarned) return;
    mixedVersionWarned = true;
    const writer = st.extVersion
      ? `extension v${st.extVersion} (save-state schema ${st.schema})`
      : `save-state schema ${st.schema}`;
    debug("mixed versions: state entries written by", writer, "— this code is", SAVE_STATE_SCHEMA);
    if (ctx.hasUI) {
      ctx.ui.notify(
        `${NOTIFY_TAG} this session was written to by a newer ${writer}, while this process runs older code — restart the session / reload Pi to load the new version`,
        "warning",
      );
    }
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
   * Every save appends a custom entry recording {branchKey, lastSavedEntryId,
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
   * resolvePlan starts a new file.
   *
   * Positions are resolved against THIS process's view of the current path:
   * a state recorded by another runtime on a genuinely diverged branch never
   * matches, so it correctly does not take over this branch's file (one
   * branch, one file).
   */
  async function computePlan(ctx: ExtensionContext): Promise<SavePlanInput | null> {
    const pathEntries = ctx.sessionManager.getBranch();
    const pathMessages = pathEntries.filter(isMessageEntry);
    if (pathMessages.length === 0) return null;

    const pos = new Map<string, number>();
    pathEntries.forEach((e, i) => pos.set(e.id, i));

    let states = await readDiskSaveStates(ctx.sessionManager.getSessionFile() ?? null);
    if (states === null) {
      states = [];
      for (const e of ctx.sessionManager.getEntries()) {
        if (e.type !== "custom" || e.customType !== CUSTOM_TYPE || !isSaveState(e.data)) continue;
        states.push(e.data);
      }
      debug("disk state unavailable — in-memory scan found", states.length, "states");
    }

    const candidates: StateCandidate[] = [];
    let order = 0;
    for (const st of states) {
      if (st.schema && isNewerSchemaVersion(st.schema, SAVE_STATE_SCHEMA)) {
        warnMixedVersions(ctx, st);
      }
      if (!st.lastSavedEntryId) continue;
      const p = pos.get(st.lastSavedEntryId);
      if (p === undefined) continue;
      candidates.push({ state: st, pos: p, order: order++ });
    }
    candidates.sort((a, b) => b.pos - a.pos || b.order - a.order);

    return { dir: targetDir(ctx), pathMessages, pos, candidates };
  }

  // ---------- writing ----------

  async function atomicWrite(file: string, content: string): Promise<void> {
    const tmp = file + ".save-tmp";
    await fs.writeFile(tmp, content, "utf-8");
    await fs.rename(tmp, file);
  }

  function replaceFrontmatter(existing: string, fm: string): string {
    if (/^---\r?\n[\s\S]*?\r?\n---\r?\n/.test(existing)) {
      return existing.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, fm + "\n");
    }
    return `${fm}\n\n${existing}`;
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
  async function resolvePlan(ctx: ExtensionContext, input: SavePlanInput): Promise<SavePlan> {
    if (input.candidates.length === 0) {
      return freshFilePlan(ctx, input.dir, input.pathMessages);
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
      return {
        dir: input.dir,
        filename: c.state.file,
        branchKey: c.state.branchKey,
        fullCreate: false,
        appendEntries,
        pathMessages: input.pathMessages,
        state: c.state,
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

  async function saveConversation(ctx: ExtensionContext, plan: SavePlan): Promise<SaveResult> {
    const filePath = path.join(plan.dir, plan.filename);

    await fs.mkdir(plan.dir, { recursive: true });

    if (plan.fullCreate) {
      const meta = computeMeta(ctx, plan.pathMessages, plan.branchKey, undefined, undefined);
      const body = renderEntries(plan.pathMessages); // ends with the trailing separator
      const content = `${frontmatter(meta)}\n\n# ${meta.title}\n\n${body}`;
      await atomicWrite(filePath, content);
      debug("created conversation file:", filePath);
      return {
        message: `saved ${plan.filename} (${plan.pathMessages.length} messages)`,
        wrote: true,
        created: true,
        file: filePath,
        recovered: plan.recoveryReason,
      };
    }

    if (plan.appendEntries.length === 0) {
      debug("nothing new since last save:", plan.filename);
      return {
        message: `already up to date (${plan.filename})`,
        wrote: false,
        created: false,
        file: filePath,
        // A downgrade warning (candidate chain fell back to this file) must
        // surface even when there is nothing new to append.
        recovered: plan.recoveryReason,
      };
    }

    const existing = await fs.readFile(filePath, "utf-8");
    const meta = computeMeta(
      ctx,
      plan.pathMessages,
      plan.branchKey,
      parseCreated(existing),
      parseAgent(existing),
    );
    const appended = renderEntries(plan.appendEntries); // ends with the trailing separator
    let updated = replaceFrontmatter(existing, frontmatter(meta));
    // Collapse trailing blank lines to a single newline so the separator
    // always has exactly one blank line above it, whatever earlier saves
    // (or a manual edit) left behind.
    updated = updated.replace(/\s*$/, "\n");
    // Files written by the old format end without a `---` separator; add one
    // at the boundary so old and new content stay delimited.
    updated += updated.endsWith("---\n") ? `\n${appended}` : `\n---\n\n${appended}`;
    await atomicWrite(filePath, updated);
    debug("appended", plan.appendEntries.length, "entries to:", filePath);
    return {
      message: `appended ${plan.appendEntries.length} messages to ${plan.filename}`,
      wrote: true,
      created: false,
      file: filePath,
      // A downgrade warning (candidate chain fell back to this file) must
      // surface on the append that performed the downgrade.
      recovered: plan.recoveryReason,
    };
  }

  function recordState(plan: SavePlan, leafId: string | null): void {
    pi.appendEntry(CUSTOM_TYPE, {
      branchKey: plan.branchKey,
      lastSavedEntryId: leafId,
      file: plan.filename,
      schema: SAVE_STATE_SCHEMA,
      extVersion: EXTENSION_VERSION ?? undefined,
    });
  }

  function relativeForUser(ctx: ExtensionContext, file: string): string {
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

  /** Full save cycle: write the file, then persist the branch state entry. */
  async function runSave(ctx: ExtensionContext): Promise<SaveResult> {
    const input = await computePlan(ctx);
    if (!input) {
      return {
        message: "no conversation content to save yet",
        wrote: false,
        created: false,
        file: null,
        recovered: null,
      };
    }
    const plan = await resolvePlan(ctx, input);
    const result = await saveConversation(ctx, plan);
    if (result.wrote) {
      const leafId = ctx.sessionManager.getLeafId();
      recordState(plan, leafId);
      debug("recorded state entry — branchKey:", plan.branchKey, "leaf:", leafId);
    }
    return result;
  }

  // 1. Automatic: save after every settled agent turn.
  pi.on("agent_settled", async (_event: AgentSettledEvent, ctx: ExtensionContext) => {
    debug("agent_settled — saving conversation");
    try {
      const r = await schedule(() => runSave(ctx));
      // A recovery replaces the routine "created" info: the anomaly is the
      // story worth telling, at a level that distinguishes it (warning).
      if (r.recovered && ctx.hasUI && r.file) {
        ctx.ui.notify(`${NOTIFY_TAG} ${r.recovered} → ${relativeForUser(ctx, r.file)}`, "warning");
      } else if (r.wrote && r.created && ctx.hasUI && r.file) {
        ctx.ui.notify(`${NOTIFY_TAG} ${relativeForUser(ctx, r.file)}`, "info");
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
        const r = await schedule(() => runSave(ctx));
        if (ctx.hasUI) {
          const target = r.file ? relativeForUser(ctx, r.file) : "";
          ctx.ui.notify(`${NOTIFY_TAG} ${r.message}${target ? ` → ${target}` : ""}`, "info");
          if (r.recovered && r.file) {
            ctx.ui.notify(
              `${NOTIFY_TAG} ${r.recovered} → ${relativeForUser(ctx, r.file)}`,
              "warning",
            );
          }
        }
      } catch (e) {
        debug("/" + COMMAND + " failed:", String(e));
        if (ctx.hasUI) ctx.ui.notify(`${NOTIFY_TAG} save failed: ${String(e)}`, "error");
      }
    },
  });
}

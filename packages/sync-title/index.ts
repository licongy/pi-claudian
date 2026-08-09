/**
 * @pi-claudian/sync-title
 *
 * Two-way sync between Claudian conversation titles and Pi session names.
 *
 * Claudian auto-generates conversation titles but never tells Pi about them,
 * and Pi's `/name` command never tells Claudian. This extension closes that
 * gap in both directions, with conflict resolution that never silently
 * overwrites a name you set yourself.
 *
 * How it works:
 * - Claudian stores conversation metadata in `.claudian/sessions/conv-*.meta.json`.
 *   The filename is Claudian's conversationId (conv-xxx), not Pi's session UUID.
 * - Meta fields:
 *     meta.id                        = Claudian conversationId
 *     meta.title                     = Claudian auto-generated title
 *                                     (produced asynchronously after the first reply)
 *     meta.titleGenerationStatus     = "pending" | "success" | ...
 *     meta.sessionId                 = Pi session UUID (may be null when not running)
 *     meta.providerState.sessionFile = absolute path to the Pi session jsonl
 * - On the Pi side, the session name is written into the jsonl's session_info
 *   entry via pi.setSessionName() and shown in the /resume list.
 *
 * Two-way sync strategy (single decision table in reconcile()):
 *
 *   trigger                  Pi name   Claudian title   action
 *   -----------------------  --------  ---------------  ---------------------------
 *   any                      empty     empty            backoff retry (title not ready)
 *   any                      empty     ready            Claudian -> Pi
 *   any                      ready     empty            Pi -> Claudian (unless "pending")
 *   any                      ready     same             no-op
 *   agent_end (automatic)    ready     different        notify only (never auto-overwrite)
 *   /name or /sync-title     ready     different        prompt: Pi->C / C->Pi / keep / cancel
 *
 * Triggers: session_start (primary — on resume Claudian's meta is already
 * complete, so the title is pulled in reliably), agent_end (per-turn, with a
 * backoff retry that outlasts Claudian's async title generation), and the
 * manual /sync-title command. Claudian links the Pi sessionId into its meta and
 * generates the title asynchronously after the first turn, so a not-yet-ready
 * title is retried on a backoff (see RETRY_DELAYS_MS). session_start is also the
 * only trigger that retries while no meta matches yet, so plain `pi` sessions
 * run inside a Claudian vault are not spun on every turn.
 *
 * Matching: first exact-match by sessionId, then fall back to the sessionFile
 * path (compared through fs.realpath so symlinked vaults match). The Claudian
 * sessions dir is resolved from the extension's `ctx.cwd` (the session's
 * recorded home directory, not process.cwd()), walking upward to the nearest
 * `.claudian/sessions` — see claudian-vault.ts.
 * Reentrancy: pi.setSessionName() re-emits session_info_changed synchronously
 * (agent-session.js), so writes performed by this extension are guarded by a
 * self-write flag to avoid re-entering the decision table.
 *
 * Installation:
 *   pi install npm:@pi-claudian/sync-title
 *
 * Usage:
 *   - Automatic: after each agent turn the two titles are reconciled
 *   - Manual: run /sync-title to reconcile the current session on demand
 *   - Batch:    run /sync-title-all to reconcile every Claudian conversation
 *               in this vault at once (fills empty names; skips conflicts)
 *   - Debug: PI_CLAUDIAN_DEBUG=1 pi
 */

import type {
  AgentEndEvent,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  SessionInfoChangedEvent,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { debug } from "./debug.js";
import { resolveClaudianSessionsDir, samePath } from "./claudian-vault.js";

/**
 * Backoff schedule for retries while Claudian's title is still being generated.
 * Claudian generates the title asynchronously (a separate model call) and only
 * links the Pi sessionId/sessionFile into the meta after the first turn, so the
 * extension waits and retries on this schedule rather than failing fast.
 * Each entry is the delay before the next attempt; the array length is the
 * total retry budget (~2 minutes), which outlasts Claudian's title generation.
 */
const RETRY_DELAYS_MS = [10_000, 15_000, 20_000, 30_000, 45_000];
const MAX_RETRY_ATTEMPTS = RETRY_DELAYS_MS.length;

/**
 * Check whether the current session has any message entries (user or assistant).
 * Claudian links the Pi sessionId into its meta only after the first turn, so a
 * session with no messages cannot have a matching meta yet — scanning the
 * Claudian sessions directory would always return null and just waste I/O.
 * Returns true on error to preserve the scan (safe default).
 */
function sessionHasMessages(ctx: ExtensionContext): boolean {
  try {
    return ctx.sessionManager.getBranch().some((e) => e.type === "message");
  } catch {
    debug("sessionHasMessages: getBranch() failed — assuming content present (safe default)");
    return true;
  }
}

interface ClaudianMeta {
  id?: string;
  title?: string;
  titleGenerationStatus?: string;
  sessionId?: string | null;
  providerState?: {
    sessionFile?: string;
    sessionId?: string;
  };
}

/**
 * Minimal shape of a Pi session jsonl entry, as needed by the batch sync. Pi
 * writes one JSON object per line; the relevant fields here are `type`, `id`
 * (tree node id, absent only on the v1 `session` header), and `name` (only on
 * `session_info` entries).
 */
interface JsonlEntry {
  type?: string;
  id?: string;
  name?: string;
}

/**
 * Generate a short (8 hex char) id that does not collide with any existing
 * entry id in a session file. Mirrors Pi's own `generateId()` so appended
 * `session_info` entries are indistinguishable from Pi-written ones.
 */
function uniqueEntryId(existing: Set<string>): string {
  for (let i = 0; i < 100; i++) {
    const id = randomUUID().slice(0, 8);
    if (!existing.has(id)) return id;
  }
  return randomUUID();
}

interface SessionScan {
  /** The file exists and is readable. */
  exists: boolean;
  /** Latest `session_info` name (trimmed), or undefined when none was ever set. */
  piName: string | undefined;
  /** id of the last non-`session` entry — the tree leaf Pi would chain from. */
  leafId: string | null;
  /** All entry ids seen in the file (for collision-free id generation). */
  ids: Set<string>;
}

/**
 * Scan a Pi session jsonl to recover the current session name and tree leaf.
 * `getSessionName()` walks entries in reverse for the latest `session_info`,
 * and `_buildIndex()` sets the leaf id to the last non-`session` entry's id, so
 * this reproduces both in a single forward pass. Corrupt / mid-write lines are
 * skipped so a concurrent write cannot poison the scan.
 */
async function scanSessionFile(sessionFile: string): Promise<SessionScan> {
  let text: string;
  try {
    text = await fs.readFile(sessionFile, "utf-8");
  } catch {
    return { exists: false, piName: undefined, leafId: null, ids: new Set() };
  }
  const ids = new Set<string>();
  let piName: string | undefined;
  let leafId: string | null = null;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: JsonlEntry;
    try {
      entry = JSON.parse(trimmed) as JsonlEntry;
    } catch {
      continue; // skip corrupt / mid-write lines
    }
    if (typeof entry.id === "string") ids.add(entry.id);
    if (entry.type === "session_info") {
      piName = entry.name?.trim() || undefined;
    }
    if (entry.type !== "session" && typeof entry.id === "string") {
      leafId = entry.id;
    }
  }
  return { exists: true, piName, leafId, ids };
}

/**
 * Append a `session_info` entry to another session's jsonl, mirroring Pi's
 * `appendSessionInfo()` (sanitized name, `parentId` = current leaf, unique id).
 * Used by the batch sync to backfill a Claudian title into a session that is
 * not currently loaded (the live `pi.setSessionName()` API can only touch the
 * current session). The file is re-scanned immediately before the append so a
 * prior append to the same file advances the leaf correctly.
 */
async function appendSessionInfoToFile(sessionFile: string, name: string): Promise<void> {
  const scan = await scanSessionFile(sessionFile);
  if (!scan.exists) {
    debug("session file missing, cannot write name:", sessionFile);
    return;
  }
  const entry = {
    type: "session_info",
    id: uniqueEntryId(scan.ids),
    parentId: scan.leafId,
    timestamp: new Date().toISOString(),
    name: name.replace(/[\r\n]+/g, " ").trim(),
  };
  await fs.appendFile(sessionFile, JSON.stringify(entry) + "\n", "utf-8");
  debug("appended session_info to", sessionFile, ":", entry.name);
}

export default function (pi: ExtensionAPI) {
  // Prevent retry timers from stacking for the same session
  const pendingRetries = new Map<string, ReturnType<typeof setTimeout>>();
  // Reentrancy guard: set just before this extension calls setSessionName() so
  // the resulting session_info_changed event is consumed instead of reprocessed.
  let selfWritingName = false;

  async function findMetaForSession(
    sessionsDir: string,
    sessionId: string,
    sessionFile: string | null,
  ): Promise<{ meta: ClaudianMeta; file: string } | null> {
    debug("scanning", sessionsDir, "for session", sessionId);
    let files: string[] = [];
    try {
      files = await fs.readdir(sessionsDir);
    } catch {
      debug("sessions dir unreadable:", sessionsDir);
      return null;
    }

    let fileFallback: { meta: ClaudianMeta; file: string } | null = null;

    for (const f of files) {
      if (!f.endsWith(".meta.json")) continue;
      const fullPath = path.join(sessionsDir, f);
      let meta: ClaudianMeta;
      try {
        meta = JSON.parse(await fs.readFile(fullPath, "utf-8"));
      } catch {
        continue; // skip corrupt / mid-write files
      }

      // Primary match: exact Pi session UUID
      if (meta.sessionId && meta.sessionId === sessionId) {
        debug("matched by sessionId:", fullPath);
        return { meta, file: fullPath };
      }

      // Fallback match: sessionFile path (realpath-aware; guards against a missing/stale meta.sessionId)
      if (
        sessionFile &&
        meta.providerState?.sessionFile &&
        (await samePath(meta.providerState.sessionFile, sessionFile))
      ) {
        debug("matched by sessionFile fallback:", fullPath);
        fileFallback = { meta, file: fullPath };
      }
    }
    return fileFallback;
  }

  /** Atomically patch a Claudian meta file (write tmp + rename) so Claudian never reads a half-written file. */
  async function writeClaudianMeta(
    file: string,
    meta: ClaudianMeta,
    patch: Partial<ClaudianMeta>,
  ): Promise<void> {
    const updated = { ...meta, ...patch };
    const tmp = file + ".sync-tmp";
    await fs.writeFile(tmp, JSON.stringify(updated, null, 2), "utf-8");
    await fs.rename(tmp, file);
    debug("wrote claudian meta:", file, patch);
  }

  /** Set the Pi session name while arming the reentrancy guard. */
  function applySessionName(name: string) {
    selfWritingName = true;
    pi.setSessionName(name);
  }

  interface ReconcileOptions {
    /** Allow interactive conflict resolution (select dialog). False for automatic triggers. */
    interactive: boolean;
    /** Allow scheduling delayed retries when Claudian's title is not ready yet. */
    canRetry?: boolean;
    /** Retry attempt index (0 = initial trigger). Caps the retry budget. */
    attempt?: number;
    /**
     * Allow retrying when no matching Claudian meta is found yet. Only set by
     * session_start: a brand-new conversation's sessionId is linked by Claudian
     * only after the first turn, so the meta legitimately may not match yet.
     * Other triggers (agent_end) rely on the next turn instead, to avoid a
     * retry storm for plain `pi` sessions run inside a Claudian vault.
     */
    allowNoMatchRetry?: boolean;
  }

  /**
   * Single decision table for both sync directions. Resolves the Pi session name against the
   * Claudian conversation title, writing whichever side is empty and prompting the
   * user (when interactive) on conflicts.
   *
   * @returns whether sync settled (or was confirmed unnecessary); false means a retry is queued.
   */
  async function reconcile(ctx: ExtensionContext, opts: ReconcileOptions): Promise<boolean> {
    const sessionId = ctx.sessionManager.getSessionId();
    if (!sessionId) {
      debug("no session id — ephemeral session, skipping");
      return true; // ephemeral session, nothing to sync
    }

    const attempt = opts.attempt ?? 0;
    const canScheduleRetry = opts.canRetry === true && attempt < MAX_RETRY_ATTEMPTS;

    const sessionFile = ctx.sessionManager.getSessionFile() ?? null;

    const sessionsDir = await resolveClaudianSessionsDir(ctx);
    if (!sessionsDir) {
      debug("no claudian sessions dir enclosing cwd — not a Claudian environment");
      return true; // not a Claudian-originated session (e.g. a plain TUI session)
    }

    // Claudian links the Pi sessionId into its meta only after the first turn
    // completes, so a session with no message entries cannot have a matching
    // meta yet. Skip the directory scan entirely in that case — it would always
    // return null and just waste I/O. This also lets us cancel retries for idle
    // plain `pi` sessions started inside a Claudian vault (no conversation at
    // all) instead of scanning the directory 6 times over ~2 minutes.
    const hasContent = sessionHasMessages(ctx);

    const found = hasContent ? await findMetaForSession(sessionsDir, sessionId, sessionFile) : null;
    if (!found) {
      // Inside a Claudian vault but no meta references this session yet. For a
      // brand-new conversation this is expected: Claudian links the Pi sessionId
      // (via get_state) only after the first turn completes. Only session_start
      // retries here (see allowNoMatchRetry) so plain `pi` sessions run inside a
      // vault don't spin retries on every turn.
      if (canScheduleRetry && opts.allowNoMatchRetry) {
        // On retries (attempt > 0), if no conversation has happened yet, stop
        // retrying. By retry time a real Claudian conversation would have its
        // first turn underway (message entries present); an idle plain `pi`
        // session never will. The initial session_start (attempt 0) always
        // schedules retry #1 because a brand-new Claudian conversation also
        // has no content yet — the meta is linked only after the first turn.
        if (attempt > 0 && !hasContent) {
          debug("no matching Claudian meta and no conversation content — not a Claudian session");
          return true;
        }
        debug("no matching Claudian meta yet — scheduling retry #" + (attempt + 1));
        scheduleRetry(ctx, sessionId, attempt + 1, true);
        return false;
      }
      debug("no matching Claudian meta — not a Claudian session");
      return true; // not a Claudian-originated session (e.g. a plain TUI session)
    }

    const { meta, file } = found;
    const piName = pi.getSessionName()?.trim() || undefined;
    const cTitle = meta.title?.trim() || undefined;
    const pending = meta.titleGenerationStatus === "pending";

    // --- Pi name empty: only Claudian -> Pi is possible ---
    if (!piName) {
      if (!cTitle) {
        // Claudian title not ready yet: it may still be generating (status
        // "pending") or, for a brand-new conversation, Claudian may not have
        // written/linked the title at all. Retry on a backoff until the budget
        // runs out, then wait for the next turn / session_start.
        debug(
          "both empty (status:",
          meta.titleGenerationStatus ?? "?",
          ") —",
          canScheduleRetry ? "scheduling retry #" + (attempt + 1) : "giving up",
        );
        if (canScheduleRetry)
          scheduleRetry(ctx, sessionId, attempt + 1, opts.allowNoMatchRetry ?? false);
        return false;
      }
      // Claudian has a title, Pi does not -> write it through
      debug("writing session name from Claudian:", cTitle);
      applySessionName(cTitle);
      ctx.ui.notify(`[Title Sync] Synced Claudian title: "${cTitle}"`, "info");
      return true;
    }

    // --- Pi name non-empty from here ---
    if (!cTitle) {
      // Pi -> Claudian, unless Claudian is mid-generation
      if (pending) {
        debug("Claudian title still pending; not writing Pi name back");
        ctx.ui.notify(
          "[Title Sync] Claudian is still generating its title; try again shortly",
          "info",
        );
        return true;
      }
      debug("writing Claudian title from pi:", piName);
      await writeClaudianMeta(file, meta, {
        title: piName,
        titleGenerationStatus: "success",
      });
      ctx.ui.notify(`[Title Sync] Synced Pi name to Claudian: "${piName}"`, "info");
      return true;
    }

    // --- both non-empty ---
    if (piName === cTitle) {
      debug("name and title already matches, no write needed");
      return true;
    }

    // Conflict: never auto-overwrite a user-named session.
    if (opts.interactive && ctx.hasUI) {
      debug("conflict — prompting user; pi:", piName, "claudian:", cTitle);
      const message =
        "Session name conflict detected\n\n" +
        `Claudian title: "${cTitle}"\n` +
        `Pi name:        "${piName}"\n\n` +
        "Choose how to resolve:";
      const choice = await ctx.ui.select(message, [
        "Overwrite Claudian title with Pi name",
        "Overwrite Pi name with Claudian title",
        "Keep both unchanged (no sync)",
        "Cancel",
      ]);
      if (choice === undefined) {
        return true; // dialog dismissed
      }
      if (choice.startsWith("Overwrite Claudian title")) {
        await writeClaudianMeta(file, meta, {
          title: piName,
          titleGenerationStatus: "success",
        });
        ctx.ui.notify(`[Title Sync] Overwrote Claudian title with: "${piName}"`, "info");
      } else if (choice.startsWith("Overwrite Pi name")) {
        debug("overwriting Pi name with Claudian:", cTitle);
        applySessionName(cTitle);
        ctx.ui.notify(`[Title Sync] Overwrote Pi name with: "${cTitle}"`, "info");
      } else if (choice.startsWith("Keep both")) {
        debug("keeping both unchanged; Pi:", piName, "claudian:", cTitle);
        ctx.ui.notify(`[Title Sync] Kept both:Pi "${piName}", Claudian "${cTitle}"`, "info");
      } else {
        ctx.ui.notify("[Title Sync] Skipped (cancelled)", "info");
      }
      return true;
    }

    // Automatic trigger with a conflict: notify only, keep the existing Pi name.
    debug("conflict on automatic trigger — notifying, keeping Pi name:", piName);
    ctx.ui.notify(
      `[Title Sync] Pi name "${piName}" differs from Claudian "${cTitle}"; kept Pi name`,
      "info",
    );
    return true;
  }

  function scheduleRetry(
    ctx: ExtensionContext,
    sessionId: string,
    nextAttempt: number,
    allowNoMatchRetry: boolean,
  ) {
    if (pendingRetries.has(sessionId)) return; // a retry is already queued
    const delay = RETRY_DELAYS_MS[nextAttempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
    debug("scheduling retry #" + nextAttempt, "in", delay, "ms for", sessionId);
    const timer = setTimeout(async () => {
      pendingRetries.delete(sessionId);
      try {
        await reconcile(ctx, {
          interactive: false,
          canRetry: true,
          attempt: nextAttempt,
          allowNoMatchRetry,
        });
      } catch (e) {
        debug("retry #" + nextAttempt + " failed:", String(e));
        /* failed attempt; the budget cap stops further auto-scheduling */
      }
    }, delay);
    pendingRetries.set(sessionId, timer);
  }

  /**
   * Batch two-way sync across every Claudian conversation in the current vault.
   * Driven by the `/sync-title-all` command. Unlike the per-session
   * `reconcile()`, this scans all `conv-*.meta.json` files and applies the same
   * decision table to each — but non-interactively: it only fills empty names
   * (Claudian → Pi, Pi → Claudian) and **skips conflicts without overwriting**,
   * reporting them so the user can resolve each with `/sync-title`.
   *
   * The current session is synced through the live `pi.setSessionName()` API
   * (so Pi's in-memory state stays consistent); every other session is synced
   * by appending a `session_info` entry directly to its jsonl, which Pi picks up
   * on the next resume. A confirm dialog summarizes the plan before any writes.
   */
  async function reconcileAll(ctx: ExtensionCommandContext): Promise<void> {
    const sessionsDir = await resolveClaudianSessionsDir(ctx);
    if (!sessionsDir) {
      ctx.ui.notify(
        "[Title Sync] Not a Claudian vault (no .claudian/sessions enclosing cwd)",
        "warning",
      );
      return;
    }

    let files: string[] = [];
    try {
      files = await fs.readdir(sessionsDir);
    } catch (e) {
      ctx.ui.notify(`[Title Sync] Cannot read sessions dir: ${String(e)}`, "error");
      return;
    }

    const currentId = ctx.sessionManager.getSessionId() ?? "";
    const currentFile = ctx.sessionManager.getSessionFile() ?? null;

    type Action = "c2p" | "p2c" | "noop" | "skip";
    interface BatchItem {
      meta: ClaudianMeta;
      file: string;
      sessionFile: string;
      isCurrent: boolean;
      piName: string | undefined;
      cTitle: string | undefined;
      action: Action;
      name: string;
      reason: string;
    }

    const items: BatchItem[] = [];
    for (const f of files) {
      if (!f.endsWith(".meta.json")) continue; // skip .deleted.json / .inputs.json
      const file = path.join(sessionsDir, f);
      let meta: ClaudianMeta;
      try {
        meta = JSON.parse(await fs.readFile(file, "utf-8"));
      } catch {
        continue; // skip corrupt / mid-write meta
      }
      const sessionFile = meta.providerState?.sessionFile;
      if (!sessionFile) continue; // not a Pi-backed conversation

      const isCurrent =
        (!!currentId && !!meta.sessionId && meta.sessionId === currentId) ||
        (!!currentFile && (await samePath(sessionFile, currentFile)));

      // The live name is authoritative for the current session (the jsonl on
      // disk may lag Pi's in-memory state mid-turn); every other session reads
      // its name from the jsonl.
      const piName = isCurrent
        ? pi.getSessionName()?.trim() || undefined
        : (await scanSessionFile(sessionFile)).piName;
      const cTitle = meta.title?.trim() || undefined;
      const pending = meta.titleGenerationStatus === "pending";

      let action: Action = "skip";
      let name = "";
      let reason = "";

      if (!piName && !cTitle) {
        reason = "not-ready";
      } else if (!piName && cTitle) {
        action = "c2p";
        name = cTitle;
      } else if (piName && !cTitle) {
        if (pending) {
          reason = "pending";
        } else {
          action = "p2c";
          name = piName;
        }
      } else if (piName === cTitle) {
        action = "noop";
        reason = "in-sync";
      } else {
        reason = "conflict";
      }

      items.push({ meta, file, sessionFile, isCurrent, piName, cTitle, action, name, reason });
    }

    const c2p = items.filter((i) => i.action === "c2p");
    const p2c = items.filter((i) => i.action === "p2c");
    const conflicts = items.filter((i) => i.reason === "conflict");
    const notReady = items.filter((i) => i.reason === "not-ready" || i.reason === "pending");
    const inSync = items.filter((i) => i.action === "noop");

    if (c2p.length === 0 && p2c.length === 0) {
      ctx.ui.notify(
        `[Title Sync] Nothing to sync: ${inSync.length} in sync, ` +
          `${conflicts.length} conflicts, ${notReady.length} not ready ` +
          `(of ${items.length} conversations)`,
        "info",
      );
      return;
    }

    // Summarize the plan and confirm before touching any files.
    const lines: string[] = [`Scanned ${items.length} Claudian conversations.`];
    const summarize = (header: string, list: BatchItem[], render: (i: BatchItem) => string) => {
      if (!list.length) return;
      lines.push("", `${header} (${list.length}):`);
      for (const i of list) lines.push(`  • ${render(i)}`);
    };
    summarize(
      "Claudian → Pi",
      c2p,
      (i) => `"${i.cTitle}"${i.isCurrent ? "  [current session]" : ""}`,
    );
    summarize("Pi → Claudian", p2c, (i) => `"${i.piName}"`);
    if (conflicts.length) {
      lines.push("", `Skipped conflicts (${conflicts.length}) — resume + /sync-title to resolve:`);
      for (const i of conflicts) lines.push(`  • Pi "${i.piName}" vs Claudian "${i.cTitle}"`);
    }
    lines.push("", "Proceed?");

    if (ctx.hasUI) {
      const ok = await ctx.ui.confirm("Sync all session titles", lines.join("\n"));
      if (!ok) {
        ctx.ui.notify("[Title Sync] Cancelled", "info");
        return;
      }
    }

    let done = 0;
    for (const i of c2p) {
      try {
        if (i.isCurrent) {
          applySessionName(i.name);
        } else {
          await appendSessionInfoToFile(i.sessionFile, i.name);
        }
        done++;
      } catch (e) {
        debug("batch Claudian→Pi failed for", i.sessionFile, ":", String(e));
      }
    }
    for (const i of p2c) {
      try {
        await writeClaudianMeta(i.file, i.meta, {
          title: i.name,
          titleGenerationStatus: "success",
        });
        done++;
      } catch (e) {
        debug("batch Pi→Claudian failed for", i.file, ":", String(e));
      }
    }

    ctx.ui.notify(
      `[Title Sync] Synced ${done}/${c2p.length + p2c.length} ` +
        `(${c2p.length} Claudian→Pi, ${p2c.length} Pi→Claudian)` +
        (conflicts.length ? `; ${conflicts.length} conflict(s) skipped` : ""),
      "info",
    );
  }

  // 0. On session start (especially resume): Claudian has already persisted the
  //    conversation meta from a prior run, so this is the most reliable moment to
  //    pull the Claudian title into the Pi session name. For a brand-new
  //    conversation the meta may not be linked to this Pi session yet (Claudian
  //    links the sessionId only after the first turn) — allowNoMatchRetry lets a
  //    backoff retry catch the link once the first turn completes.
  pi.on("session_start", async (_event: SessionStartEvent, ctx: ExtensionContext) => {
    debug("session_start — attempting reconcile");
    try {
      await reconcile(ctx, { interactive: false, canRetry: true, allowNoMatchRetry: true });
    } catch (e) {
      debug("session_start sync error:", String(e));
      /* ignore transient errors */
    }
  });

  // 1. Automatic: resolve after each reply ends. For a new conversation the title
  //    is usually still being generated asynchronously by Claudian -> backoff
  //    retry until it lands. Non-interactive: never auto-overwrite a named session.
  pi.on("agent_end", async (_event: AgentEndEvent, ctx: ExtensionContext) => {
    debug("agent_end — attempting reconcile");
    try {
      await reconcile(ctx, { interactive: false, canRetry: true });
    } catch (e) {
      debug("agent_end sync error:", String(e));
      /* ignore transient errors */
    }
  });

  // 2. After the user names a session (/name): bias toward Pi -> Claudian, prompt
  //    on conflict. The self-write guard short-circuits events this extension caused.
  pi.on("session_info_changed", async (event: SessionInfoChangedEvent, ctx: ExtensionContext) => {
    if (selfWritingName) {
      debug("consuming self-triggered session_info_changed");
      selfWritingName = false;
      return;
    }
    if (!event.name) {
      debug("name cleared — skipping write-back");
      return; // clearing the name must not erase the Claudian title
    }
    debug("session_info_changed — attempting reconcile");
    try {
      await reconcile(ctx, { interactive: true });
    } catch (e) {
      debug("session_info_changed sync error:", String(e));
      /* ignore transient errors */
    }
  });

  // 3. Manual trigger: /sync-title (interactive — may prompt on conflict)
  pi.registerCommand("sync-title", {
    description:
      "Two-way sync between the Pi session name and the Claudian conversation title (.claudian/sessions metadata)",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      try {
        debug("manual /sync-title invoked");
        const done = await reconcile(ctx, { interactive: true, canRetry: true });
        if (!done) {
          ctx.ui.notify(
            "[Title Sync] Claudian title not ready yet; retrying in the background",
            "info",
          );
        }
      } catch (e) {
        debug("/sync-title failed:", String(e));
        ctx.ui.notify(`[Title Sync] Sync failed: ${String(e)}`, "error");
      }
    },
  });

  // 4. Manual batch trigger: /sync-title-all — reconcile every Claudian
  //    conversation in this vault at once. Non-destructive: fills empty names
  //    in both directions and skips conflicts (reports them so each can be
  //    resolved individually with /sync-title). The current session is synced
  //    live; others are synced by appending to their jsonl (picked up on next
  //    resume). Prompts a plan + confirm before writing.
  pi.registerCommand("sync-title-all", {
    description:
      "Batch-sync the Claudian title and Pi session name for ALL conversations in this vault " +
      "(fills empty names; skips conflicts without overwriting)",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      try {
        debug("manual /sync-title-all invoked");
        await reconcileAll(ctx);
      } catch (e) {
        debug("/sync-title-all failed:", String(e));
        ctx.ui.notify(`[Title Sync] Batch sync failed: ${String(e)}`, "error");
      }
    },
  });
}

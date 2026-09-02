/**
 * @pi-claudian/sync-session
 *
 * Sync Pi session-tree changes (/tree, /fork, /clone) into Claudian's
 * conversation metadata.
 *
 * Claudian tracks each pi-provider conversation in
 * `.claudian/sessions/conv-<id>.meta.json` (top level, or the per-device
 * `devices/<deviceId>/` subdirectories Claudian 2.2.5+ files new metas
 * into), including the active position in
 * Pi's session tree:
 *
 *   meta.sessionId                  = Pi session UUID
 *   meta.providerState.sessionFile  = absolute path to the Pi session jsonl
 *   meta.providerState.sessionId    = Pi session UUID
 *   meta.providerState.leafEntryId  = the Pi entry the conversation is at
 *
 * Claudian never watches Pi for changes, so several Pi operations leave its
 * metadata stale:
 *
 * - /tree (navigateTree): stays in the SAME session file but moves the active
 *   leaf to an earlier entry (optionally appending a branch_summary). Claudian
 *   still points at the old leaf, so resuming opens the wrong branch.
 * - /tree + re-ask: after navigating, the user edits and resubmits a new
 *   message, creating new entries that advance the leaf PAST the navigated-to
 *   position. The `session_tree` event only captured the navigated-to leaf, not
 *   the new entries. Without a follow-up sync, Claudian opens at the wrong
 *   (pre-re-ask) position.
 * - /fork & /clone (fork): creates a NEW session file + UUID. Claudian has no
 *   conversation for the new session, so it never appears in Claudian's list.
 *
 * This extension closes that gap (Pi -> Claudian only):
 *
 * - On `session_tree`: writes the new leaf id into the matching meta's
 *   `providerState.leafEntryId`.
 * - On `agent_settled`: re-syncs the current leaf after every turn. This is
 *   essential for the /tree + re-ask flow — the session_tree event wrote the
 *   *navigated-to* leaf, but the re-ask created new entries that advanced the
 *   leaf further. agent_settled fires once the turn is fully done (after any
 *   retries/compaction), so the written leafEntryId is the final position.
 *   Silent when the leaf is already in sync; transient widget only on actual
 *   write. Also bumps `lastActivityAt` so Claudian detects the conversation
 *   changed and re-reads the session file instead of serving a stale cache.
 * - On `session_start` with reason "fork": creates a new conv-*.meta.json for
 *   the forked session, copying the title/model from the source conversation
 *   and pointing at the new sessionFile/sessionId/leafEntryId.
 * - On `session_start` with reason "resume": auto-backfills the conversation's
 *   top-level `sessionId` (and providerState) if missing. Claudian's
 *   `resolveMissingConversationSession` strips `leafEntryId` when neither a
 *   top-level nor providerState `sessionId` is present, making the conversation
 *   unresumable. Writing the Pi session id in both places is the safety net
 *   that preserves the binding through such a false alarm. Silent unless a
 *   meta was actually patched.
 * - `/sync-session`: re-syncs the current leaf on demand.
 *
 * Claudian -> Pi fork conversion is not handled here — there is no need:
 * Claudian already creates the Pi session file (and its conv meta) when it
 * forks a Pi-based conversation, so the Pi side is already up to date. Claudian
 * owns the Pi session lifecycle for its own conversations and performs that
 * conversion in its own process, where a session-scoped Pi extension cannot
 * reliably observe it. This extension therefore only does the opposite
 * direction (Pi -> Claudian), which Claudian does not do itself.
 *
 * Matching: by Pi sessionId first, falling back to the sessionFile path.
 * Writes are atomic (tmp + rename) so Claudian never reads a half-written file.
 * patchMeta re-reads the file right before writing so concurrent Claudian
 * changes (lastActivityAt, usage, etc.) are preserved — only the explicit
 * sync fields are overlaid, not the stale snapshot from the initial scan.
 * Silent no-op outside of a Claudian-managed vault.
 *
 * Vault resolution: Pi sets the extension's `ctx.cwd` to the session's recorded
 * home directory (the jsonl header's `cwd`), NOT to `process.cwd()`. So when a
 * Claudian session is resumed from a sub-directory, `ctx.cwd` is the vault root
 * and the sessions dir is derived from `ctx.cwd`, walking upward to the nearest
 * `.claudian/sessions`. Path matching goes through `fs.realpath` so symlinked
 * vaults compare equal. See claudian-vault.ts.
 *
 * Installation:
 *   pi install npm:@pi-claudian/sync-session
 *
 * Debug:
 *   PI_CLAUDIAN_DEBUG=1 pi
 */

import type {
  AgentSettledEvent,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  SessionStartEvent,
  SessionTreeEvent,
} from "@earendil-works/pi-coding-agent";
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { debug } from "./debug.js";
import { listClaudianMetaFiles, resolveClaudianSessionsDir, samePath } from "./claudian-vault.js";

interface ClaudianProviderState {
  leafEntryId?: string | null;
  sessionFile?: string;
  sessionId?: string;
}

interface ClaudianMeta {
  id?: string;
  providerId?: string;
  title?: string;
  titleGenerationStatus?: string;
  createdAt?: number;
  updatedAt?: number;
  lastResponseAt?: number;
  lastActivityAt?: number;
  sessionId?: string | null;
  selectedModel?: string;
  providerState?: ClaudianProviderState;
  usage?: Record<string, unknown>;
}

interface MetaFile {
  meta: ClaudianMeta;
  file: string;
}

const CLAUDIAN_PROVIDER_PI = "pi";

export default function (pi: ExtensionAPI) {
  /**
   * Read every conv-*.meta.json in a Claudian sessions dir, across both
   * storage layouts (top level and the per-device `devices/<deviceId>/`
   * subdirectories — see listClaudianMetaFiles), skipping corrupt/mid-write
   * files.
   */
  async function readAllMetas(sessionsDir: string): Promise<MetaFile[]> {
    let files: string[] = [];
    try {
      files = await listClaudianMetaFiles(sessionsDir);
    } catch {
      debug("sessions dir unreadable:", sessionsDir);
      return [];
    }

    const out: MetaFile[] = [];
    for (const fullPath of files) {
      try {
        const meta = JSON.parse(await fs.readFile(fullPath, "utf-8")) as ClaudianMeta;
        out.push({ meta, file: fullPath });
      } catch {
        continue; // skip corrupt / mid-write files
      }
    }
    return out;
  }

  /** Find the Claudian conversation backing a Pi session, by sessionId then sessionFile path. */
  async function findMeta(
    sessionsDir: string,
    sessionId: string,
    sessionFile: string | null,
  ): Promise<MetaFile | null> {
    const metas = await readAllMetas(sessionsDir);
    let fileFallback: MetaFile | null = null;
    for (const m of metas) {
      const ms = m.meta.sessionId;
      const ps = m.meta.providerState?.sessionId;
      if ((ms && ms === sessionId) || (ps && ps === sessionId)) {
        debug("matched by sessionId:", m.file);
        return m;
      }
      if (
        sessionFile &&
        m.meta.providerState?.sessionFile &&
        (await samePath(m.meta.providerState.sessionFile, sessionFile))
      ) {
        debug("matched by sessionFile fallback:", m.file);
        fileFallback = m;
      }
    }
    return fileFallback;
  }

  /** Find a Claudian conversation by the Pi session file path (used to locate the fork source). */
  async function findMetaBySessionFile(
    sessionsDir: string,
    sessionFile: string,
  ): Promise<MetaFile | null> {
    const metas = await readAllMetas(sessionsDir);
    for (const m of metas) {
      const f = m.meta.providerState?.sessionFile;
      if (f && (await samePath(f, sessionFile))) {
        debug("matched fork source by sessionFile:", m.file);
        return m;
      }
    }
    return null;
  }

  /** Find a Claudian conversation by Pi sessionId (used for fork idempotency). */
  async function findMetaBySessionId(
    sessionsDir: string,
    sessionId: string,
  ): Promise<MetaFile | null> {
    const metas = await readAllMetas(sessionsDir);
    for (const m of metas) {
      const ms = m.meta.sessionId;
      const ps = m.meta.providerState?.sessionId;
      if ((ms && ms === sessionId) || (ps && ps === sessionId)) {
        return m;
      }
    }
    return null;
  }

  /**
   * Atomically patch a Claudian meta file (write tmp + rename).
   *
   * Re-reads the file right before writing so concurrent changes by Claudian
   * (e.g. lastActivityAt, usage) are preserved — only the explicit `patch`
   * fields are overlaid on the latest on-disk content, not the stale snapshot
   * from findMeta().
   */
  async function patchMeta(
    file: string,
    meta: ClaudianMeta,
    patch: Partial<ClaudianMeta>,
  ): Promise<void> {
    let latest = meta;
    try {
      latest = JSON.parse(await fs.readFile(file, "utf-8")) as ClaudianMeta;
    } catch {
      // file deleted or corrupt — fall back to the snapshot we already have
    }
    const now = Date.now();
    const updated = { ...latest, ...patch, updatedAt: now };
    const tmp = file + ".sync-tmp";
    await fs.writeFile(tmp, JSON.stringify(updated, null, 2), "utf-8");
    await fs.rename(tmp, file);
    debug("patched claudian meta:", file, patch);
  }

  /** Atomically write a brand-new Claudian meta file. */
  async function writeMeta(file: string, meta: ClaudianMeta): Promise<void> {
    const tmp = file + ".sync-tmp";
    await fs.writeFile(tmp, JSON.stringify(meta, null, 2), "utf-8");
    await fs.rename(tmp, file);
    debug("wrote new claudian meta:", file);
  }

  /** Generate a Claudian-style conversation id: conv-<epoch-ms>-<9 alphanum>. */
  function generateConvId(): string {
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    const bytes = crypto.randomBytes(9);
    let suffix = "";
    for (let i = 0; i < 9; i++) {
      suffix += alphabet[bytes[i] % alphabet.length];
    }
    return `conv-${Date.now()}-${suffix}`;
  }

  /** A structured result from a sync operation, turned into a TUI notification. */
  interface SyncOutcome {
    message: string;
    type: "info" | "warning" | "error";
    /** True when a meta file was actually written/patched (vs a no-op/skip). */
    written: boolean;
  }
  /** One entry in a synced-sessions summary list. */
  interface SyncItem {
    id: string;
    name?: string;
    detail?: string;
  }

  /** Display label for a session: "id (name)" when named, else just "id". */
  function sessionLabel(id: string, name?: string): string {
    return name ? `${id} (${name})` : id;
  }

  /** Build a multi-line "Synced N session(s) to Claudian" summary body for the TUI. */
  function summarizeSynced(items: SyncItem[], action = "Synced"): string {
    const n = items.length;
    const noun = n === 1 ? "session" : "sessions";
    const lines = [`${action} ${n} ${noun} to Claudian:`];
    for (const it of items) {
      lines.push(`  • ${sessionLabel(it.id, it.name)}`);
      if (it.detail) lines.push(`      ${it.detail}`);
    }
    return lines.join("\n");
  }

  function outcome(
    message: string,
    type: SyncOutcome["type"] = "info",
    written = false,
  ): SyncOutcome {
    return { message: `[Session Sync] ${message}`, type, written };
  }

  /**
   * Sync the current Pi leaf into the Claudian conversation that backs this
   * session. Used by `session_tree` and the manual `/sync-session` command.
   */
  async function syncLeaf(ctx: ExtensionContext): Promise<SyncOutcome> {
    const sessionId = ctx.sessionManager.getSessionId();
    if (!sessionId) {
      debug("no session id — ephemeral session, skipping leaf sync");
      return outcome("no active session — nothing to sync");
    }
    const name = ctx.sessionManager.getSessionName();
    const sessionFile = ctx.sessionManager.getSessionFile() ?? null;
    const leafId = ctx.sessionManager.getLeafId();

    const sessionsDir = await resolveClaudianSessionsDir(ctx);
    if (!sessionsDir) {
      debug("no claudian sessions dir enclosing cwd — not a Claudian environment");
      return outcome("not a Claudian environment — nothing to sync", "warning");
    }

    const found = await findMeta(sessionsDir, sessionId, sessionFile);
    if (!found) {
      debug("no matching Claudian meta — not a Claudian session");
      return outcome("not a Claudian session — nothing to sync", "warning");
    }

    const { meta, file } = found;
    // Only pi-provider conversations are meaningful here.
    if (meta.providerId && meta.providerId !== CLAUDIAN_PROVIDER_PI) {
      debug("non-pi provider conversation:", meta.providerId);
      return outcome(`provider is ${meta.providerId}, not pi — skipped`, "warning");
    }

    const currentLeaf = meta.providerState?.leafEntryId ?? null;
    const currentTopSessionId = meta.sessionId ?? null;
    const topSessionIdStale = currentTopSessionId !== sessionId;

    if (leafId === currentLeaf && !topSessionIdStale) {
      debug("leaf already in sync:", leafId);
      return outcome(
        summarizeSynced(
          [{ id: sessionId, name, detail: `leaf already in sync (${leafId ?? "null"})` }],
          "Already synced",
        ),
      );
    }

    const providerState: ClaudianProviderState = {
      ...(meta.providerState ?? {}),
      leafEntryId: leafId,
      sessionFile: sessionFile ?? meta.providerState?.sessionFile,
      sessionId: meta.providerState?.sessionId ?? sessionId,
    };
    const patch: Partial<ClaudianMeta> = {
      providerState,
      // Bump lastActivityAt so Claudian detects the conversation changed
      // and re-reads the session file instead of serving a stale cache.
      // Claudian never watches Pi for changes; without this, its display
      // freezes at the pre-/tree state even though leafEntryId is correct.
      lastActivityAt: Date.now(),
    };
    if (topSessionIdStale) patch.sessionId = sessionId;
    await patchMeta(file, meta, patch);
    debug(
      "synced leaf:",
      currentLeaf,
      "->",
      leafId,
      "top sessionId:",
      currentTopSessionId,
      "->",
      sessionId,
    );
    const details: string[] = [];
    if (leafId !== currentLeaf) {
      details.push(`leaf ${currentLeaf ?? "null"} → ${leafId ?? "null"}`);
    }
    if (topSessionIdStale) {
      details.push(`sessionId ${currentTopSessionId ?? "null"} → ${sessionId}`);
    }
    return outcome(
      summarizeSynced([{ id: sessionId, name, detail: details.join(", ") }]),
      "info",
      true,
    );
  }

  /**
   * Handle a Pi fork (/fork, /clone): the new session is now active. Locate the
   * source conversation by previousSessionFile and create a new Claudian
   * conversation pointing at the forked session.
   */
  async function syncFork(event: SessionStartEvent, ctx: ExtensionContext): Promise<SyncOutcome> {
    const previousSessionFile = event.previousSessionFile;
    if (!previousSessionFile) {
      debug("fork without previousSessionFile — cannot locate source conversation");
      return outcome("no source session to fork from", "warning");
    }

    const newSessionId = ctx.sessionManager.getSessionId();
    if (!newSessionId) {
      debug("forked session has no id — skipping");
      return outcome("forked session has no id", "warning");
    }
    const newName = ctx.sessionManager.getSessionName();

    const sessionsDir = await resolveClaudianSessionsDir(ctx);
    if (!sessionsDir) {
      debug("no claudian sessions dir enclosing cwd — fork not synced");
      return outcome("not a Claudian environment — nothing to sync", "warning");
    }

    // Idempotency: a Claudian conversation may already exist for the new
    // session (e.g. Claudian's own fork conversion, or a re-fired event).
    const existing = await findMetaBySessionId(sessionsDir, newSessionId);
    if (existing) {
      debug("claudian conversation already exists for forked session:", existing.file);
      // Still reconcile the leaf so Claudian opens at the right position.
      return await syncLeaf(ctx);
    }

    const source = await findMetaBySessionFile(sessionsDir, previousSessionFile);
    if (!source) {
      debug("source session is not a Claudian conversation — not creating a fork meta");
      return outcome("source is not a Claudian conversation — nothing to sync", "warning");
    }

    const src = source.meta;
    const newSessionFile = ctx.sessionManager.getSessionFile() ?? undefined;
    const newLeafId = ctx.sessionManager.getLeafId();
    const now = Date.now();
    const convId = generateConvId();

    const forked: ClaudianMeta = {
      ...src,
      id: convId,
      providerId: CLAUDIAN_PROVIDER_PI,
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
      lastResponseAt: undefined,
      sessionId: newSessionId,
      providerState: {
        leafEntryId: newLeafId,
        sessionFile: newSessionFile,
        sessionId: newSessionId,
      },
      // Inherit the source title (Claudian's list shows something meaningful
      // immediately); sync-title will reconcile the Pi name on the next turn.
    };

    const file = path.join(sessionsDir, `${convId}.meta.json`);
    await writeMeta(file, forked);
    debug("created fork conversation:", convId, "from", src.id);
    const sourceLabel = src.title ? `"${src.title}"` : (src.id ?? previousSessionFile);
    return outcome(
      summarizeSynced([
        {
          id: newSessionId,
          name: newName,
          detail: `created conversation ${convId} (forked from ${sourceLabel})`,
        },
      ]),
      "info",
      true,
    );
  }

  const SYNC_WIDGET_KEY = "pi-claudian-sync";
  const WIDGET_CLEAR_MS = 15000;
  let widgetTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Show the sync result. Pi's own follow-up status after /tree ("Navigated to
   * selected point") and /fork ("Forked to new session") replaces the last chat
   * status line — and /tree also re-renders the chat — so an info `notify` sent
   * from `session_tree`/`session_start` gets overwritten before it can be read.
   * A widget lives in a separate container that Pi does not touch, so it is the
   * reliable channel for automatic triggers. Manual `/sync-session` has no such
   * follow-up, so it uses a persistent status line instead.
   */
  function presentOutcome(ctx: ExtensionContext, o: SyncOutcome, transient: boolean): void {
    if (o.type === "error" || !transient) {
      ctx.ui.notify(o.message, o.type);
      return;
    }
    if (widgetTimer) clearTimeout(widgetTimer);
    const lines = o.message.split("\n");
    lines[0] = `${lines[0]} (this message will auto-dismiss shortly)`;
    ctx.ui.setWidget(SYNC_WIDGET_KEY, lines);
    widgetTimer = setTimeout(() => {
      widgetTimer = undefined;
      try {
        ctx.ui.setWidget(SYNC_WIDGET_KEY, undefined);
      } catch (e) {
        debug("widget clear failed (stale ctx):", String(e));
      }
    }, WIDGET_CLEAR_MS);
  }

  // 1. /tree navigation: write the new leaf into Claudian's metadata.
  pi.on("session_tree", async (event: SessionTreeEvent, ctx: ExtensionContext) => {
    debug("session_tree — newLeaf:", event.newLeafId, "oldLeaf:", event.oldLeafId);
    try {
      presentOutcome(ctx, await syncLeaf(ctx), true);
    } catch (e) {
      debug("session_tree sync error:", String(e));
      presentOutcome(ctx, outcome(`tree sync failed: ${String(e)}`, "error"), true);
    }
  });

  // 2. /fork & /clone: create a Claudian conversation for the forked session.
  //    /resume (Claudian opens an existing conversation): auto-backfill the
  //    top-level sessionId so Claudian's missing-session cleanup cannot strip
  //    leafEntryId. Silent unless something was actually written.
  pi.on("session_start", async (event: SessionStartEvent, ctx: ExtensionContext) => {
    if (event.reason === "fork") {
      debug("session_start (fork) — previousSessionFile:", event.previousSessionFile);
      try {
        presentOutcome(ctx, await syncFork(event, ctx), true);
      } catch (e) {
        debug("fork sync error:", String(e));
        presentOutcome(ctx, outcome(`fork sync failed: ${String(e)}`, "error"), true);
      }
      return;
    }
    if (event.reason === "resume") {
      debug("session_start (resume) — auto-backfill check");
      try {
        const o = await syncLeaf(ctx);
        // Only surface when a meta was actually patched (e.g. sessionId was
        // missing and got backfilled). A clean resume stays silent.
        if (o.written) presentOutcome(ctx, o, true);
      } catch (e) {
        debug("resume sync error:", String(e));
        presentOutcome(ctx, outcome(`resume sync failed: ${String(e)}`, "error"), true);
      }
    }
  });

  // 3. agent_settled: after every turn the leaf may have advanced (most
  //    critically after /tree navigation + re-ask, where the session_tree
  //    event only wrote the *navigated-to* leaf, not the new entries created
  //    by the re-ask). Syncing here keeps Claudian's leafEntryId current
  //    without requiring a manual /sync-session. Silent when the leaf is
  //    already in sync; transient widget only when a meta was actually written.
  pi.on("agent_settled", async (_event: AgentSettledEvent, ctx: ExtensionContext) => {
    try {
      const o = await syncLeaf(ctx);
      if (o.written) presentOutcome(ctx, o, true);
    } catch (e) {
      debug("agent_settled sync error:", String(e));
    }
  });

  // 4. Manual: re-sync the current leaf on demand.
  pi.registerCommand("sync-session", {
    description:
      "Sync the Pi session tree position (leaf) and any fork into Claudian's session metadata (.claudian/sessions)",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      try {
        debug("manual /sync-session invoked");
        presentOutcome(ctx, await syncLeaf(ctx), false);
      } catch (e) {
        debug("/sync-session failed:", String(e));
        presentOutcome(ctx, outcome(`sync failed: ${String(e)}`, "error"), false);
      }
    },
  });
}

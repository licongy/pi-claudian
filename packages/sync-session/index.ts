/**
 * @pi-claudian/sync-session
 *
 * Sync pi session-tree changes (/tree, /fork, /clone) into Claudian's
 * conversation metadata.
 *
 * Claudian tracks each pi-provider conversation in
 * `.claudian/sessions/conv-<id>.meta.json`, including the active position in
 * pi's session tree:
 *
 *   meta.sessionId                  = pi session UUID
 *   meta.providerState.sessionFile  = absolute path to the pi session jsonl
 *   meta.providerState.sessionId    = pi session UUID
 *   meta.providerState.leafEntryId  = the pi entry the conversation is at
 *
 * Claudian never watches pi for changes, so two pi operations leave its
 * metadata stale:
 *
 * - /tree (navigateTree): stays in the SAME session file but moves the active
 *   leaf to an earlier entry (optionally appending a branch_summary). Claudian
 *   still points at the old leaf, so resuming opens the wrong branch.
 * - /fork & /clone (fork): creates a NEW session file + UUID. Claudian has no
 *   conversation for the new session, so it never appears in Claudian's list.
 *
 * This extension closes that gap (pi -> Claudian only):
 *
 * - On `session_tree`: writes the new leaf id into the matching meta's
 *   `providerState.leafEntryId`.
 * - On `session_start` with reason "fork": creates a new conv-*.meta.json for
 *   the forked session, copying the title/model from the source conversation
 *   and pointing at the new sessionFile/sessionId/leafEntryId.
 * - `/sync-session`: re-syncs the current leaf on demand.
 *
 * Claudian -> pi fork conversion is not handled here — there is no need:
 * Claudian already creates the pi session file (and its conv meta) when it
 * forks a pi-based conversation, so the pi side is already up to date. Claudian
 * owns the pi-session lifecycle for its own conversations and performs that
 * conversion in its own process, where a session-scoped pi extension cannot
 * reliably observe it. This extension therefore only does the opposite
 * direction (pi -> Claudian), which Claudian does not do itself.
 *
 * Matching: by pi sessionId first, falling back to the sessionFile path.
 * Writes are atomic (tmp + rename) so Claudian never reads a half-written file.
 * Silent no-op outside of a Claudian-managed vault.
 *
 * Installation:
 *   pi install npm:@pi-claudian/sync-session
 *
 * Debug:
 *   PI_CLAUDIAN_DEBUG=1 pi
 */

import type {
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
  function claudianSessionsDir(): string {
    // Claudian starts pi with the vault root as cwd
    return path.join(process.cwd(), ".claudian", "sessions");
  }

  /** Read every conv-*.meta.json in the Claudian sessions dir (skipping corrupt/mid-write files). */
  async function readAllMetas(): Promise<MetaFile[]> {
    const dir = claudianSessionsDir();
    let files: string[] = [];
    try {
      files = await fs.readdir(dir);
    } catch {
      debug("sessions dir missing — not a Claudian environment");
      return []; // .claudian/sessions missing (not a Claudian environment)
    }

    const out: MetaFile[] = [];
    for (const f of files) {
      if (!f.endsWith(".meta.json")) continue;
      const fullPath = path.join(dir, f);
      try {
        const meta = JSON.parse(await fs.readFile(fullPath, "utf-8")) as ClaudianMeta;
        out.push({ meta, file: fullPath });
      } catch {
        continue; // skip corrupt / mid-write files
      }
    }
    return out;
  }

  /** Find the Claudian conversation backing a pi session, by sessionId then sessionFile path. */
  async function findMeta(sessionId: string, sessionFile: string | null): Promise<MetaFile | null> {
    const metas = await readAllMetas();
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
        samePath(m.meta.providerState.sessionFile, sessionFile)
      ) {
        debug("matched by sessionFile fallback:", m.file);
        fileFallback = m;
      }
    }
    return fileFallback;
  }

  /** Find a Claudian conversation by the pi session file path (used to locate the fork source). */
  async function findMetaBySessionFile(sessionFile: string): Promise<MetaFile | null> {
    const metas = await readAllMetas();
    for (const m of metas) {
      const f = m.meta.providerState?.sessionFile;
      if (f && samePath(f, sessionFile)) {
        debug("matched fork source by sessionFile:", m.file);
        return m;
      }
    }
    return null;
  }

  /** Find a Claudian conversation by pi sessionId (used for fork idempotency). */
  async function findMetaBySessionId(sessionId: string): Promise<MetaFile | null> {
    const metas = await readAllMetas();
    for (const m of metas) {
      const ms = m.meta.sessionId;
      const ps = m.meta.providerState?.sessionId;
      if ((ms && ms === sessionId) || (ps && ps === sessionId)) {
        return m;
      }
    }
    return null;
  }

  /** Atomically patch a Claudian meta file (write tmp + rename). */
  async function patchMeta(
    file: string,
    meta: ClaudianMeta,
    patch: Partial<ClaudianMeta>,
  ): Promise<void> {
    const updated = { ...meta, ...patch, updatedAt: Date.now() };
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

  function outcome(message: string, type: SyncOutcome["type"] = "info"): SyncOutcome {
    return { message: `[Session Sync] ${message}`, type };
  }

  /**
   * Sync the current pi leaf into the Claudian conversation that backs this
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

    const found = await findMeta(sessionId, sessionFile);
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
    if (leafId === currentLeaf) {
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
    await patchMeta(file, meta, { providerState });
    debug("synced leaf:", currentLeaf, "->", leafId);
    return outcome(
      summarizeSynced([
        { id: sessionId, name, detail: `leaf ${currentLeaf ?? "null"} → ${leafId ?? "null"}` },
      ]),
    );
  }

  /**
   * Handle a pi fork (/fork, /clone): the new session is now active. Locate the
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

    // Idempotency: a Claudian conversation may already exist for the new
    // session (e.g. Claudian's own fork conversion, or a re-fired event).
    const existing = await findMetaBySessionId(newSessionId);
    if (existing) {
      debug("claudian conversation already exists for forked session:", existing.file);
      // Still reconcile the leaf so Claudian opens at the right position.
      return await syncLeaf(ctx);
    }

    const source = await findMetaBySessionFile(previousSessionFile);
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
      lastResponseAt: undefined,
      sessionId: newSessionId,
      providerState: {
        leafEntryId: newLeafId,
        sessionFile: newSessionFile,
        sessionId: newSessionId,
      },
      // Inherit the source title (Claudian's list shows something meaningful
      // immediately); sync-title will reconcile the pi name on the next turn.
    };

    const file = path.join(claudianSessionsDir(), `${convId}.meta.json`);
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
   * A widget lives in a separate container that pi does not touch, so it is the
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
  pi.on("session_start", async (event: SessionStartEvent, ctx: ExtensionContext) => {
    if (event.reason !== "fork") return;
    debug("session_start (fork) — previousSessionFile:", event.previousSessionFile);
    try {
      presentOutcome(ctx, await syncFork(event, ctx), true);
    } catch (e) {
      debug("fork sync error:", String(e));
      presentOutcome(ctx, outcome(`fork sync failed: ${String(e)}`, "error"), true);
    }
  });

  // 3. Manual: re-sync the current leaf on demand.
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

/** Compare two filesystem paths robustly (case-insensitive on darwin/win). */
function samePath(a: string, b: string): boolean {
  const norm = (p: string) => path.resolve(p);
  if (process.platform === "win32" || process.platform === "darwin") {
    return norm(a).toLowerCase() === norm(b).toLowerCase();
  }
  return norm(a) === norm(b);
}

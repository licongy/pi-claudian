import type {
  AgentEndEvent,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { debug } from "./debug.js";

/**
 * @pi-claudian/sync-title
 *
 * How it works (verified):
 * - Claudian stores conversation metadata in the vault's
 *   .claudian/sessions/conv-*.meta.json. The filename is Claudian's
 *   conversationId (conv-xxx), not pi's session UUID.
 * - Meta fields:
 *     meta.id                        = Claudian conversationId
 *     meta.title                     = Claudian auto-generated title
 *                                     (produced asynchronously after the first reply)
 *     meta.titleGenerationStatus     = "pending" | "success" | ...
 *     meta.sessionId                 = pi session UUID (may be null when not running)
 *     meta.providerState.sessionFile = absolute path to the pi session jsonl
 * - On the pi side, the session name is written into the jsonl's session_info
 *   entry via pi.setSessionName() and shown in the /resume list. Claudian never
 *   calls it itself, so this extension bridges the gap.
 *
 * Matching: first exact-match by sessionId, then fall back to the sessionFile path.
 * Timing: sync once on agent_end; if the meta exists but the title is not ready
 * (pending), retry once after 10 seconds (covers Claudian's async title
 * generation via a small model).
 */

const RETRY_DELAY_MS = 10_000;

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

export default function (pi: ExtensionAPI) {
  // Prevent retry timers from stacking for the same session
  const pendingRetries = new Map<string, ReturnType<typeof setTimeout>>();

  function claudianSessionsDir(): string {
    // Claudian starts pi with the vault root as cwd
    return path.join(process.cwd(), ".claudian", "sessions");
  }

  async function findMetaForSession(
    sessionId: string,
    sessionFile: string | null,
  ): Promise<{ meta: ClaudianMeta; file: string } | null> {
    const dir = claudianSessionsDir();
    debug("scanning", dir, "for session", sessionId);
    let files: string[] = [];
    try {
      files = await fs.readdir(dir);
    } catch {
      debug("sessions dir missing — not a Claudian environment");
      return null; // .claudian/sessions missing (not a Claudian environment)
    }

    let fileFallback: { meta: ClaudianMeta; file: string } | null = null;

    for (const f of files) {
      if (!f.endsWith(".meta.json")) continue;
      const fullPath = path.join(dir, f);
      let meta: ClaudianMeta;
      try {
        meta = JSON.parse(await fs.readFile(fullPath, "utf-8"));
      } catch {
        continue; // skip corrupt / mid-write files
      }

      // Primary match: exact pi session UUID
      if (meta.sessionId && meta.sessionId === sessionId) {
        debug("matched by sessionId:", fullPath);
        return { meta, file: fullPath };
      }

      // Fallback match: exact sessionFile path (guards against a missing/stale meta.sessionId)
      if (
        sessionFile &&
        meta.providerState?.sessionFile &&
        meta.providerState.sessionFile === sessionFile
      ) {
        debug("matched by sessionFile fallback:", fullPath);
        fileFallback = { meta, file: fullPath };
      }
    }
    return fileFallback;
  }

  /**
   * @param isRetry true for a delayed retry; do not re-queue on failure
   * @returns whether sync completed (or was confirmed unnecessary)
   */
  async function syncTitleFromClaudian(ctx: ExtensionContext, isRetry = false): Promise<boolean> {
    const sessionId = ctx.sessionManager.getSessionId();
    if (!sessionId) {
      debug("no session id — ephemeral session, skipping");
      return true; // ephemeral session, nothing to sync
    }

    const sessionFile = ctx.sessionManager.getSessionFile() ?? null;

    const found = await findMetaForSession(sessionId, sessionFile);
    if (!found) {
      debug("no matching Claudian meta — not a Claudian session");
      return true; // not a Claudian-originated session (e.g. a plain TUI session)
    }

    const { meta } = found;
    const title = meta.title?.trim();

    // Title not ready yet (Claudian is calling the small model) -> hand off to retry
    if (!title) {
      debug(
        "title not ready (status:",
        meta.titleGenerationStatus ?? "?",
        ") —",
        isRetry ? "giving up" : "scheduling retry",
      );
      if (!isRetry) scheduleRetry(ctx, sessionId);
      return false;
    }

    // Idempotent: skip if the name already matches
    if (pi.getSessionName() === title) {
      debug("title already matches, no write needed");
      return true;
    }

    debug("writing session name:", title);
    pi.setSessionName(title); // write the session_info entry, immediately visible in /resume
    ctx.ui.notify(`[Title Sync] Synced Claudian title: "${title}"`, "info");
    return true;
  }

  function scheduleRetry(ctx: ExtensionContext, sessionId: string) {
    if (pendingRetries.has(sessionId)) return; // a retry is already queued
    debug("scheduling retry in", RETRY_DELAY_MS, "ms for", sessionId);
    const timer = setTimeout(async () => {
      pendingRetries.delete(sessionId);
      try {
        await syncTitleFromClaudian(ctx, true);
      } catch (e) {
        debug("retry failed:", String(e));
        /* retry failed silently; wait for the next agent_end */
      }
    }, RETRY_DELAY_MS);
    pendingRetries.set(sessionId, timer);
  }

  // 1. Try to sync after each reply ends (first turn usually has no title yet -> auto 10s retry)
  pi.on("agent_end", async (_event: AgentEndEvent, ctx: ExtensionContext) => {
    debug("agent_end — attempting sync");
    try {
      await syncTitleFromClaudian(ctx);
    } catch (e) {
      debug("agent_end sync error:", String(e));
      /* ignore transient errors */
    }
  });

  // 2. Manual trigger: /sync-title
  pi.registerCommand("sync-title", {
    description:
      "Manually sync the Claudian conversation title from .claudian/sessions metadata into the pi session name",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      try {
        debug("manual /sync-title invoked");
        const done = await syncTitleFromClaudian(ctx);
        if (!done) {
          ctx.ui.notify(
            "[Title Sync] Claudian title not ready yet; a retry is scheduled in 10 seconds",
            "info",
          );
        }
      } catch (e) {
        debug("/sync-title failed:", String(e));
        ctx.ui.notify(`[Title Sync] Sync failed: ${String(e)}`, "error");
      }
    },
  });
}

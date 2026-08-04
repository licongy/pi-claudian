/**
 * Claudian vault resolution for @pi-claudian extensions.
 *
 * Claudian stores conversation metadata under `<vault>/.claudian/sessions/`.
 * Earlier extensions assumed `process.cwd()` *is* the vault root. That breaks
 * when Pi is launched from a sub-directory and a Claudian session is resumed:
 * Pi sets the extension's `ctx.cwd` to the *session's* recorded home directory
 * (the jsonl header's `cwd`, see SessionManager.getCwd()), NOT to
 * `process.cwd()`. Deriving the sessions dir from `process.cwd()` therefore
 * misses the vault in that case and silently skips the sync.
 *
 * This module resolves the nearest enclosing `.claudian/sessions` directory by
 * walking up from the extension's own `ctx.cwd`, and provides a realpath-aware
 * path comparison so symlinked vaults match correctly.
 *
 * Cross-vault safety: pi's session id is globally unique and each vault keeps
 * its own `.claudian/sessions`, so a session from vault A has no meta inside
 * vault B — `findMeta` simply returns null there. Because `ctx.cwd` is the
 * session's own home, the resolved vault is always the one that owns the
 * session, so no extra cross-vault guard is needed.
 *
 * Source-only (Pi loads it via jiti). Each @pi-claudian package vendors its
 * own copy, mirroring the debug.ts convention.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { debug } from "./debug.js";

const SESSIONS_REL = path.join(".claudian", "sessions");

// pi's cwd is fixed for the lifetime of a process, so a single cached lookup
// is enough. If a different start path is ever seen it simply re-walks.
let cachedStart: string | undefined;
let cachedSessionsDir: string | undefined;

/**
 * Resolve the nearest `.claudian/sessions` directory enclosing the extension's
 * `ctx.cwd`. Walks upward so a session whose home is a sub-directory of the
 * vault still resolves to the vault. Returns `undefined` when no Claudian vault
 * encloses the current directory (a plain TUI session, or a non-Claudian
 * project) — callers treat that as a silent no-op.
 */
export async function resolveClaudianSessionsDir(
  ctx: ExtensionContext,
): Promise<string | undefined> {
  const start = ctx.cwd;
  if (start === cachedStart) return cachedSessionsDir;

  let dir = start;
  for (;;) {
    const candidate = path.join(dir, SESSIONS_REL);
    try {
      await fs.access(candidate);
      cachedStart = start;
      cachedSessionsDir = candidate;
      debug("resolved claudian sessions dir:", candidate, "(from", start, ")");
      return candidate;
    } catch {
      // not present at this level — keep walking up
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }

  cachedStart = start;
  cachedSessionsDir = undefined;
  debug("no .claudian/sessions enclosing", start, "— not a Claudian environment");
  return undefined;
}

/**
 * Robust path equality: resolves both paths through `fs.realpath` (so symlinked
 * directories compare equal) before a case-insensitive compare on darwin/win.
 * Falls back to lexical resolution when a path does not exist on disk.
 */
export async function samePath(a: string, b: string): Promise<boolean> {
  const norm = async (p: string): Promise<string> => {
    const rp = await realpathOrSelf(p);
    return process.platform === "win32" || process.platform === "darwin" ? rp.toLowerCase() : rp;
  };
  return (await norm(a)) === (await norm(b));
}

async function realpathOrSelf(p: string): Promise<string> {
  try {
    return await fs.realpath(p);
  } catch {
    return path.resolve(p);
  }
}

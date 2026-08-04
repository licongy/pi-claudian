/**
 * Shared debug logging for all @pi-claudian extensions.
 *
 * Enable by setting the PI_CLAUDIAN_DEBUG environment variable to any truthy
 * value (e.g. "1"). Output goes to stderr via console.error, so it never mixes
 * with pi's stdout and can be captured separately:
 *
 *   PI_CLAUDIAN_DEBUG=1 pi            # show inline
 *   PI_CLAUDIAN_DEBUG=1 pi 2>debug.log  # capture to a file
 *
 * This is a source-only module (Pi loads it via jiti). Each @pi-claudian
 * package vendors its own copy and imports it, keeping packages independent —
 * the shared contract is the PI_CLAUDIAN_DEBUG env var name, not a shared
 * npm dependency.
 */

const TAG = "[pi-claudian]";
const enabled = Boolean(process.env.PI_CLAUDIAN_DEBUG);

/** Log a debug message when PI_CLAUDIAN_DEBUG is set. */
export function debug(...args: unknown[]): void {
  if (!enabled) return;
  console.error(TAG, ...args);
}

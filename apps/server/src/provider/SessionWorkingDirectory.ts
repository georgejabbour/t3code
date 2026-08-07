// @effect-diagnostics nodeBuiltinImport:off
/**
 * SessionWorkingDirectory - Checks the folder an agent is about to run in.
 *
 * Every provider runs its agent as a child program, and every child program
 * starts inside one folder. Node refuses to start the child when that folder is
 * gone, and the error it gives back names the program, not the folder. The
 * Claude Agent SDK turns that error into a message about a mismatched system
 * library, which sends the reader in the wrong direction.
 *
 * A thread keeps the path of its git worktree after somebody deletes that
 * worktree, so a thread can point at a folder that no longer exists. Check the
 * folder before the agent starts and report the real reason.
 *
 * @module SessionWorkingDirectory
 */
import * as NodeFS from "node:fs";

/**
 * Returns a reason the agent cannot run in `cwd`, or `undefined` when the
 * folder is usable. `statSync` follows symbolic links, which is what the child
 * program does too.
 */
export function describeUnusableSessionCwd(cwd: string): string | undefined {
  let stats: NodeFS.Stats;
  try {
    stats = NodeFS.statSync(cwd);
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException | null)?.code;
    if (code === "ENOENT") {
      return `The folder this thread runs in no longer exists: '${cwd}'. Something removed it outside T3 Code. Create the folder again, or start a new thread in a folder that exists.`;
    }
    return `The folder this thread runs in cannot be read: '${cwd}' (${code ?? "unknown error"}).`;
  }
  if (!stats.isDirectory()) {
    return `The path this thread runs in is not a folder: '${cwd}'.`;
  }
  return undefined;
}

// @effect-diagnostics nodeBuiltinImport:off
/**
 * ManagedWorktree - decide whether a folder is one T3 Code created, and whether
 * it is still on disk.
 *
 * Two features ask this question. The archived-thread sweep asks before it
 * removes a folder, and the turn-start path asks before it recreates one. Both
 * must answer the same way, so both read these functions.
 *
 * @module ManagedWorktree
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

/** Report whether `path` names a folder that exists right now. */
export const worktreeExists = (path: string): boolean => {
  try {
    return NodeFS.statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/**
 * The real location of `value`, with every symbolic link followed.
 *
 * A worktree removed by hand no longer exists, and a path that is not there
 * cannot be resolved. Its parent almost always still is, so the parent is
 * resolved instead and the last segment put back. That step matters on macOS,
 * where the temporary and home folders are themselves links: comparing an
 * unresolved `/var/…` against a resolved `/private/var/…` never matches, and
 * every removed worktree would then read as somebody else's.
 *
 * When neither the path nor its parent resolves, the plain resolved form comes
 * back. It will not sit inside the managed folder, so the caller refuses to
 * touch it, which is the safe direction.
 */
export const canonicalPath = (value: string): string => {
  const resolved = NodePath.resolve(value);
  try {
    return NodeFS.realpathSync(resolved);
  } catch {
    try {
      const parent = NodeFS.realpathSync(NodePath.dirname(resolved));
      return NodePath.join(parent, NodePath.basename(resolved));
    } catch {
      return resolved;
    }
  }
};

/**
 * Whether `worktreePath` sits inside `managedRoot`, and may therefore be taken
 * apart or built again.
 *
 * A thread stores whatever path its worktree had, and that path can name any
 * folder on the disk. Only the ones inside the server's `worktreesDir` were
 * made by T3. Removing anything else destroys a folder somebody else depends
 * on, which is what happened to George's maintained fork checkout in August
 * 2026: two nightly sweeps ran `git worktree remove` against it, and each one
 * left that checkout with 140 tracked files deleted.
 *
 * Recreating a folder outside the managed root is wrong for the same reason.
 * T3 Code did not make it, so T3 Code does not know what belongs in it.
 *
 * Both sides are resolved through the filesystem first, so a link inside the
 * managed folder cannot stand in for a folder outside it. Containment is then
 * decided with `path.relative` rather than by comparing text, because a
 * sibling named `worktrees-elsewhere` shares the managed folder's spelling
 * without being inside it. The managed folder itself is not a worktree, so an
 * empty result is refused along with everything above it.
 */
export const isManagedWorktree = (managedRoot: string, worktreePath: string): boolean => {
  const relative = NodePath.relative(managedRoot, canonicalPath(worktreePath));
  const climbsOut = relative === ".." || relative.startsWith(`..${NodePath.sep}`);
  return relative !== "" && !climbsOut && !NodePath.isAbsolute(relative);
};

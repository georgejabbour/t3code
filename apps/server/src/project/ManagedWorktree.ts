// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

/** Resolve missing segments through their nearest existing ancestor. */
export const canonicalPath = (value: string): string | null => {
  let ancestor = NodePath.resolve(value);
  const missing: string[] = [];
  for (;;) {
    try {
      return NodePath.join(NodeFS.realpathSync(ancestor), ...missing);
    } catch (error) {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        return null;
      }
      // A dangling link cannot establish ownership of a missing checkout.
      try {
        NodeFS.lstatSync(ancestor);
        return null;
      } catch (error) {
        if (
          typeof error !== "object" ||
          error === null ||
          !("code" in error) ||
          error.code !== "ENOENT"
        ) {
          return null;
        }
      }
      const parent = NodePath.dirname(ancestor);
      if (parent === ancestor) return null;
      missing.unshift(NodePath.basename(ancestor));
      ancestor = parent;
    }
  }
};

/** Reject roots, foreign paths, and links that escape a managed directory. */
export const isManagedWorktree = (managedRoot: string, worktreePath: string): boolean => {
  const root = canonicalPath(managedRoot);
  const worktree = canonicalPath(worktreePath);
  if (root === null || worktree === null || NodePath.dirname(root) === root) return false;
  const relative = NodePath.relative(root, worktree);
  const climbsOut = relative === ".." || relative.startsWith(`..${NodePath.sep}`);
  return relative !== "" && !climbsOut && !NodePath.isAbsolute(relative);
};

/**
 * BranchPrefix - resolve the branch prefix a project wants for its threads.
 *
 * T3 Code names a new thread's branch `<prefix>/<slug>`. The prefix is
 * `t3code` unless the repository sets `branchPrefix` in its checked-in
 * `t3.json`, which lets a repository keep its own branch convention.
 *
 * Resolution never fails. A missing or invalid project file resolves to the
 * default prefix, which is the behaviour every project had before this setting
 * existed.
 *
 * @module BranchPrefix
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { resolveWorktreeBranchPrefix } from "@t3tools/shared/git";

import type { T3ProjectFileLoader } from "./T3ProjectFileLoader.ts";

/**
 * Read `branchPrefix` from the `t3.json` at `workspaceRoot`.
 *
 * Pass a thread's worktree path here. `t3.json` is checked in, so a worktree
 * carries the same file as the repository it came from, and reading the
 * worktree copy honours a branch that changes the setting.
 *
 * The caller passes the loader it resolved at layer construction, which keeps
 * this off the calling Effect's service requirements.
 */
export function resolveBranchPrefixForWorkspace(
  projectFileLoader: T3ProjectFileLoader["Service"],
  workspaceRoot: string,
): Effect.Effect<string> {
  return projectFileLoader
    .load(workspaceRoot)
    .pipe(
      Effect.map((projectFile) =>
        resolveWorktreeBranchPrefix(
          Option.isSome(projectFile) ? (projectFile.value.branchPrefix ?? null) : null,
        ),
      ),
    );
}

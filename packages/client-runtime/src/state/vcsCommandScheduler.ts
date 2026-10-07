import type { EnvironmentId } from "@t3tools/contracts";

import { createAtomCommandScheduler, type AtomCommandConcurrency } from "./runtime.ts";

export const vcsCommandScheduler = createAtomCommandScheduler();

export const vcsCommandConcurrency: AtomCommandConcurrency<{
  readonly environmentId: EnvironmentId;
  readonly input: { readonly cwd: string };
}> = {
  mode: "serial",
  key: ({ environmentId, input }) => JSON.stringify([environmentId, input.cwd]),
};

/**
 * A separate lane for the worktree archive script, which may run for minutes.
 * On the shared VCS lane it would hold the workspace's key that whole time and
 * queue refreshStatus, pull, listRefs and createWorktree behind it — the work
 * leaves the UI thread but still blocks the project. Keyed by WORKTREE, so two
 * archive runs for one worktree still cannot overlap.
 */
export const worktreeArchiveScriptScheduler = createAtomCommandScheduler();

export const worktreeArchiveScriptConcurrency: AtomCommandConcurrency<{
  readonly environmentId: EnvironmentId;
  readonly input: { readonly path: string };
}> = {
  mode: "serial",
  key: ({ environmentId, input }) => JSON.stringify([environmentId, input.path]),
};

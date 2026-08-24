import type { EnvironmentId } from "@t3tools/contracts";

import { stackPosition } from "@t3tools/client-runtime/state/git-stacks";
import { useGitStack } from "~/state/gitStacks";

// Added by this fork. A tiny "position in chain" read-out for rows that already
// show a pull request number; see Patch 16 in PATCHES.md.

/**
 * `n/N` when the branch belongs to a GitHub stack — second branch of a
 * three-branch chain reads "2/3". Renders nothing otherwise, so a repository
 * without stacks looks exactly like it did before.
 */
export function GitStackPositionMarker({
  environmentId,
  cwd,
  branchName,
}: {
  environmentId: EnvironmentId;
  cwd: string | null;
  branchName: string | null | undefined;
}) {
  const { view } = useGitStack(cwd !== null ? { environmentId, cwd } : null);
  if (!view) return null;
  const position = stackPosition(view, branchName ?? null);
  if (position === null) return null;
  return (
    <span
      data-testid="git-stack-position-marker"
      title={`Branch ${position} of ${view.branches.length} in this stack`}
      className="text-muted-foreground/70 ml-1 text-[10px] tabular-nums"
    >
      {position}/{view.branches.length}
    </span>
  );
}

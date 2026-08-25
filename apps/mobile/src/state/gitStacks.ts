import type { EnvironmentId, GitStackView } from "@t3tools/contracts";
import {
  createGitStackEnvironmentAtoms,
  stackPosition,
} from "@t3tools/client-runtime/state/git-stacks";

import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironmentQuery } from "./query";

// Added by this fork. GitHub stack reads on native; see Patch 16 in PATCHES.md.
export const gitStackEnvironment = createGitStackEnvironmentAtoms(connectionAtomRuntime);

export interface GitStackPositionLabel {
  readonly position: number;
  readonly length: number;
  readonly text: string;
}

/**
 * "n/N" for the branch's place in its stack, or null when the checkout belongs
 * to no stack or the branch is outside the chain.
 */
export function useGitStackPosition(input: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string | null;
  readonly branchName: string | null | undefined;
}): GitStackPositionLabel | null {
  const query = useEnvironmentQuery(
    input.cwd !== null
      ? gitStackEnvironment.view({
          environmentId: input.environmentId,
          input: { cwd: input.cwd },
        })
      : null,
  );
  const view = query.data;
  if (input.cwd === null || view === null) return null;
  const position = stackPosition(view, input.branchName ?? null);
  if (position === null) return null;
  return { position, length: view.branches.length, text: `${position}/${view.branches.length}` };
}

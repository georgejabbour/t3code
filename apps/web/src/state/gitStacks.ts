import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, GitStackRunActionInput, GitStackView } from "@t3tools/contracts";
import {
  createGitStackEnvironmentAtoms,
  createGitStackPositionLabelsAtomFamily,
  makeGitStackPositionLabelsKey,
  type GitStackPositionLabelTarget,
} from "@t3tools/client-runtime/state/git-stacks";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";

import { useCallback } from "react";

import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironmentQuery } from "./query";
import { useAtomCommand } from "./use-atom-command";

// Added by this fork. GitHub stack reads and actions; see Patch 16 in
// PATCHES.md.
export const gitStackEnvironment = createGitStackEnvironmentAtoms(connectionAtomRuntime);

export interface GitStackTarget {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  /**
   * The branch whose stack the caller cares about, when the checkout itself
   * may not sit on it — a pull request panel reads from the project root,
   * which usually sits on the trunk, and the extension refuses to report a
   * chain from there. The server retries from the worktree holding the branch.
   */
  readonly branch?: string;
}

/**
 * The stack covering `cwd`, or null when there is none. A failed read reads as
 * "no stack": a missing or broken `gh` install must not turn into a strip of
 * errors beside every thread that happens to sit in a repository.
 */
export function useGitStack(target: GitStackTarget | null): {
  readonly view: GitStackView | null;
  readonly isPending: boolean;
  readonly refresh: () => void;
} {
  const query = useEnvironmentQuery(
    target
      ? gitStackEnvironment.view({
          environmentId: target.environmentId,
          input: { cwd: target.cwd, ...(target.branch ? { branch: target.branch } : {}) },
        })
      : null,
  );
  return { view: query.data, isPending: query.isPending, refresh: query.refresh };
}

export interface GitStackActionOutcome {
  readonly ok: boolean;
  /** The last lines the command printed, for a toast. */
  readonly summary: string | null;
  /** The server's own failure message, which names what blocked the action. */
  readonly message: string | null;
}

type RunStackAction = (
  input: Omit<GitStackRunActionInput, "cwd"> & { readonly cwd: string },
) => Promise<GitStackActionOutcome>;

/**
 * Runs one stack action. The chain redraws from the command's own refreshed
 * view, because the action result already carries the stack read again after
 * the run.
 */
export function useGitStackAction(environmentId: EnvironmentId): {
  readonly run: RunStackAction;
} {
  const runAction = useAtomCommand(gitStackEnvironment.runAction);
  const run = useCallback<RunStackAction>(
    async ({ cwd, ...rest }) => {
      const result = await runAction({ environmentId, input: { cwd, ...rest } });
      if (result._tag === "Failure") {
        return {
          ok: false,
          summary: null,
          message: String(squashAtomCommandFailure(result)),
        };
      }
      return { ok: true, summary: result.value.summary, message: null };
    },
    [environmentId, runAction],
  );
  return { run };
}

const positionLabelsFamily = createGitStackPositionLabelsAtomFamily(gitStackEnvironment.view);

/** Extension labels for the requested pull requests only. */
export function useGitStackPositionLabels(
  targets: ReadonlyArray<GitStackPositionLabelTarget>,
): ReadonlyMap<string, string> {
  return useAtomValue(positionLabelsFamily(makeGitStackPositionLabelsKey(targets)));
}

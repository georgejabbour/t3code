import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, GitStackRunActionInput, GitStackView } from "@t3tools/contracts";
import { createGitStackEnvironmentAtoms } from "@t3tools/client-runtime/state/git-stacks";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
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
}

/**
 * The stack at `cwd`, or null when the checkout belongs to none. A read failure
 * reads as "no stack" too: a missing or broken `gh` install must not turn into
 * a strip of errors beside every thread that happens to sit in a repository.
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
          input: { cwd: target.cwd },
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

interface MergedGitStackViews {
  /** One entry per checkout whose stack could be read; failures contribute nothing. */
  readonly values: ReadonlyArray<readonly [EnvironmentId, GitStackView]>;
}

/**
 * One stack read per checkout, fanned out inside a single derived atom so React
 * can subscribe to a target list whose length changes — the same shape the pull
 * request list page uses for its cross-environment listing.
 */
const mergedViewsFamily = Atom.family((key: string) => {
  const targets = JSON.parse(key) as ReadonlyArray<{
    environmentId: string;
    input: { cwd: string };
  }>;
  return Atom.make((get): MergedGitStackViews => {
    const values: Array<readonly [EnvironmentId, GitStackView]> = [];
    for (const target of targets) {
      const result = get(
        gitStackEnvironment.view({
          environmentId: target.environmentId as EnvironmentId,
          input: target.input,
        }),
      );
      // A failed read contributes nothing rather than blanking the rest: one
      // unreachable machine must not hide every other repository's chains.
      const value = Option.getOrNull(AsyncResult.value(result));
      if (value !== null) values.push([target.environmentId as EnvironmentId, value]);
    }
    return { values };
  }).pipe(Atom.withLabel(`web-git-stacks:merged:${key}`));
});

/**
 * Branch → "position/length" labels ("2/3") for every stacked branch across the
 * given checkouts. Branch names are unique within a checkout but not across
 * repositories, so the key carries the workspace root; the branch-only form is
 * offered for callers that render rows of one known project.
 */
export function useGitStackPositionLabels(
  targets: ReadonlyArray<{ environmentId: EnvironmentId; cwd: string }>,
): ReadonlyMap<string, string> {
  const key = JSON.stringify(
    targets.map((target) => ({
      environmentId: target.environmentId,
      input: { cwd: target.cwd },
    })),
  );
  // Selected, not conditioned: the hook always subscribes to one atom, which
  // is either the shared empty one or this target list's merged view.
  const merged = useAtomValue(targets.length === 0 ? EMPTY_MERGED_VIEWS : mergedViewsFamily(key));
  const labels = new Map<string, string>();
  for (const [, view] of merged.values) {
    view.branches.forEach((branch, index) => {
      const label = `${index + 1}/${view.branches.length}`;
      labels.set(`${view.trunk} ${branch.name}`, label);
      labels.set(branch.name, label);
    });
  }
  return labels;
}

const EMPTY_MERGED_VIEWS = Atom.make<MergedGitStackViews>({ values: [] }).pipe(
  Atom.withLabel("web-git-stacks:merged:empty"),
);

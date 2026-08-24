import { WS_METHODS, type GitStackView } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

/**
 * GitHub stack reads and actions. Added by this fork. See Patch 16 in
 * PATCHES.md.
 *
 * The view answers null when a checkout belongs to no stack, which every
 * surface reads as "render nothing". Actions run serially per environment:
 * two stack commands racing in one repository would rebase against each other.
 */
export function createGitStackEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const commandScheduler = createAtomCommandScheduler();
  const serialPerEnvironment = {
    mode: "serial",
    key: ({ environmentId }: { readonly environmentId: string }) => environmentId,
  } as const;
  return {
    view: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git-stacks:view",
      tag: WS_METHODS.gitStackView,
      staleTimeMs: 15_000,
    }),
    runAction: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git-stacks:run-action",
      tag: WS_METHODS.gitStackRunAction,
      scheduler: commandScheduler,
      concurrency: serialPerEnvironment,
    }),
  };
}

export type GitStackTarget = {
  readonly environmentId: string;
  readonly input: { readonly cwd: string };
};

/** True when the branch named sits above `current` in the chain, so its pull request merges later. */
export function stackPosition(
  view: GitStackView,
  branchName: string | null | undefined,
): number | null {
  if (!branchName) return null;
  const index = view.branches.findIndex((branch) => branch.name === branchName);
  return index === -1 ? null : index + 1;
}

/** The one-line chain label, trunk-first: `main <- auth <- api`. */
export function formatStackChain(view: GitStackView): string {
  return [view.trunk, ...view.branches.map((branch) => branch.name)].join(" <- ");
}

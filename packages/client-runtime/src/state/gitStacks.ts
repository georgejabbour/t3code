import { EnvironmentId, WS_METHODS, type GitStackView } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import * as Schema from "effect/Schema";
import { parseChangeRequestUrl } from "@t3tools/shared/changeRequestUrl";
import { canonicalRepositoryKey } from "@t3tools/shared/sourceControl";

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

/** The source checkout and pull request that one extension read must describe. */
export const GitStackPositionLabelTarget = Schema.Struct({
  environmentId: EnvironmentId,
  cwd: Schema.String,
  host: Schema.String,
  repository: Schema.String,
  headBranch: Schema.String,
  number: Schema.Number,
});
export type GitStackPositionLabelTarget = typeof GitStackPositionLabelTarget.Type;

const TargetListJson = Schema.fromJsonString(Schema.Array(GitStackPositionLabelTarget));
const encodeTargets = Schema.encodeSync(TargetListJson);
const decodeTargets = Schema.decodeUnknownSync(TargetListJson);

/** Scope each label to its environment, checkout, host, repository, branch, and pull request. */
export function gitStackPositionLabelKey(target: GitStackPositionLabelTarget): string {
  return JSON.stringify([
    target.environmentId,
    target.cwd,
    target.host.toLowerCase(),
    canonicalRepositoryKey(target.repository.toLowerCase()),
    target.headBranch,
    target.number,
  ]);
}

/** Deduplicate reads and keep the family key stable when rows change order. */
export function makeGitStackPositionLabelsKey(
  targets: ReadonlyArray<GitStackPositionLabelTarget>,
): string {
  const unique = new Map(targets.map((target) => [encodeTargets([target]), target]));
  return encodeTargets(
    [...unique].sort(([left], [right]) => left.localeCompare(right)).map(([, target]) => target),
  );
}

/** Use the existing query cache; failed reads contribute no labels. */
export function createGitStackPositionLabelsAtomFamily<E>(
  getView: (target: {
    readonly environmentId: EnvironmentId;
    readonly input: { readonly cwd: string; readonly branch: string };
  }) => Atom.Atom<AsyncResult.AsyncResult<GitStackView | null, E>>,
) {
  return Atom.family((key: string) => {
    const targets = decodeTargets(key);
    return Atom.make((get): ReadonlyMap<string, string> => {
      const labels = new Map<string, string>();
      for (const target of targets) {
        const result = get(
          getView({
            environmentId: target.environmentId,
            input: { cwd: target.cwd, branch: target.headBranch },
          }),
        );
        if (!AsyncResult.isSuccess(result) || result.value === null) continue;
        const view = result.value;
        const index = view.branches.findIndex((branch) => branch.name === target.headBranch);
        const member = view.branches[index];
        if (member?.pr?.number !== target.number) continue;
        const link = parseChangeRequestUrl(member.pr.url);
        if (
          link === null ||
          link.host !== target.host.toLowerCase() ||
          canonicalRepositoryKey(link.repository) !==
            canonicalRepositoryKey(target.repository.toLowerCase()) ||
          link.number !== target.number
        )
          continue;
        labels.set(gitStackPositionLabelKey(target), `${index + 1}/${view.branches.length}`);
      }
      return labels;
    }).pipe(Atom.withLabel(`git-stacks:position-labels:${key}`));
  });
}

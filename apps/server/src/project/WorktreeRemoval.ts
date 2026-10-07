import type { VcsRemoveWorktreeInput, WorktreeArchiveScriptError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { withWorkspaceLease } from "../workspace/workspaceLease.ts";
import { WorktreeArchiveScriptRunner } from "./WorktreeArchiveScriptRunner.ts";

export class WorktreeRemoval extends Context.Service<
  WorktreeRemoval,
  {
    /**
     * Preparation checks eligibility under the workspace lease. It returns the
     * removal effect, including checks that must run again after the script.
     * An undefined result leaves the folder and does not run the script.
     */
    readonly remove: <E, R>(
      input: VcsRemoveWorktreeInput,
      prepare: Effect.Effect<Effect.Effect<void, E, R> | undefined, E, R>,
    ) => Effect.Effect<void, E | WorktreeArchiveScriptError, R>;
  }
>()("t3/project/WorktreeRemoval") {}

export const make = Effect.gen(function* () {
  const scripts = yield* WorktreeArchiveScriptRunner;
  const path = yield* Path.Path;
  const remove: WorktreeRemoval["Service"]["remove"] = (input, prepare) =>
    Effect.gen(function* () {
      const removal = yield* prepare;
      if (removal === undefined) return;
      if (input.skipArchiveScript !== true) {
        yield* scripts.run({ workspaceRoot: input.cwd, worktreePath: input.path });
      }
      yield* removal;
    }).pipe(
      (effect) => withWorkspaceLease(path.resolve(input.path), effect),
      Effect.withSpan("WorktreeRemoval.remove"),
    );
  return WorktreeRemoval.of({ remove });
});

export const layer = Layer.effect(WorktreeRemoval, make);

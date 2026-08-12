import { CommandId } from "@t3tools/contracts";
import { isTemporaryWorktreeBranch } from "@t3tools/shared/git";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { resolveBranchPrefixForWorkspace } from "../project/BranchPrefix.ts";
import * as T3ProjectFileLoader from "../project/T3ProjectFileLoader.ts";
import { forkParked } from "../serverActivation.ts";
import * as VcsStatusBroadcaster from "../vcs/VcsStatusBroadcaster.ts";
import * as Orchestrator from "./Orchestrator.ts";

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const vcs = yield* VcsStatusBroadcaster.VcsStatusBroadcaster;
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const loader = yield* T3ProjectFileLoader.T3ProjectFileLoader;
    const crypto = yield* Crypto.Crypto;
    const lastBranchByCwd = new Map<string, string | null>();
    yield* forkParked(
      vcs.streamAllStatusChanges().pipe(
        Stream.runForEach((change) =>
          Effect.gen(function* () {
            if (change.event._tag === "remoteUpdated") return;
            const branch = change.event.local.refName;
            if (lastBranchByCwd.has(change.cwd) && lastBranchByCwd.get(change.cwd) === branch) return;
            lastBranchByCwd.set(change.cwd, branch);
            if (branch === null) return;
            const prefix = yield* resolveBranchPrefixForWorkspace(loader, change.cwd);
            if (isTemporaryWorktreeBranch(branch, prefix)) return;
            const snapshot = yield* orchestrator.getShellSnapshot({ location: "active" });
            const owners = snapshot.threads.filter((thread) => thread.worktreePath === change.cwd);
            const thread = owners.length === 1 ? owners[0] : undefined;
            if (thread === undefined || thread.branch === null || thread.branch === branch) return;
            const uuid = yield* crypto.randomUUIDv4;
            yield* orchestrator.dispatch({
              type: "thread.metadata.update",
              commandId: CommandId.make(`server:worktree-branch-drift:${uuid}`),
              threadId: thread.id,
              branch,
              expectedBranch: thread.branch,
              expectedWorktreePath: change.cwd,
            });
          }).pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.failCause(cause)
                : Effect.logWarning("Could not follow the worktree branch change.", { cwd: change.cwd, cause }),
            ),
          ),
        ),
      ),
    );
  }),
).pipe(Layer.provide(T3ProjectFileLoader.layer));

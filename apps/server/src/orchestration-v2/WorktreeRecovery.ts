import { DEFAULT_SERVER_SETTINGS, ThreadId, TurnItemId } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import { isManagedWorktree } from "../project/ManagedWorktree.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import { managedWorktreesDirectories } from "../worktreesDirectory.ts";
import { withWorkspaceLease } from "../workspace/workspaceLease.ts";
import * as EventSink from "./EventSink.ts";
import * as IdAllocator from "./IdAllocator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

/** Share saved-worktree recovery between turn starts and checkpoint rollback. */
export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const eventSink = yield* EventSink.EventSinkV2;
  const ids = yield* IdAllocator.IdAllocatorV2;
  const config = yield* Effect.serviceOption(ServerConfig.ServerConfig);
  const git = yield* Effect.serviceOption(GitWorkflow.GitWorkflowService);
  const projects = yield* Effect.serviceOption(ProjectService.ProjectService);
  const settingsService = yield* Effect.serviceOption(ServerSettings.ServerSettingsService);
  const path = yield* Effect.serviceOption(Path.Path);

  return Effect.fn("WorktreeRecovery.restore")(
    function* (threadId: ThreadId, cwd: string | null) {
      if (
        cwd === null ||
        Option.isNone(config) ||
        Option.isNone(git) ||
        Option.isNone(projects) ||
        Option.isNone(path)
      )
        return;
      const settings = Option.isSome(settingsService)
        ? yield* settingsService.value.getSettings
        : DEFAULT_SERVER_SETTINGS;
      const roots = managedWorktreesDirectories(settings, config.value.worktreesDir, path.value);
      if (!roots.some((root) => isManagedWorktree(root, cwd))) return;
      const gitWorkflow = git.value;
      const projectService = projects.value;
      yield* withWorkspaceLease(
        path.value.resolve(cwd),
        Effect.gen(function* () {
          if (!roots.some((root) => isManagedWorktree(root, cwd))) return;
          if (yield* fileSystem.exists(cwd)) return;
          const thread = yield* projections.getThread(threadId);
          if (thread.deletedAt !== null || thread.worktreePath !== cwd || thread.branch === null)
            return;
          const project = yield* projectService.getById(thread.projectId);
          if (Option.isNone(project)) return;
          const submodules = resolveProjectSettings(settings, thread.projectId).settings
            .worktreeSubmodules;
          yield* gitWorkflow.pruneWorktrees({ cwd: project.value.workspaceRoot });
          const current = yield* projections.getThread(threadId);
          if (
            current.deletedAt !== null ||
            current.worktreePath !== cwd ||
            current.branch !== thread.branch ||
            current.projectId !== thread.projectId
          )
            return;
          if (
            !roots.some((root) => isManagedWorktree(root, cwd)) ||
            (yield* fileSystem.exists(cwd))
          )
            return;
          yield* gitWorkflow.createWorktree(
            { cwd: project.value.workspaceRoot, refName: thread.branch, path: cwd },
            { submodules },
          );
          const now = yield* DateTime.now;
          const eventId = yield* ids.allocate.event({ threadId });
          yield* eventSink.write({
            events: [
              {
                id: eventId,
                type: "turn-item.updated",
                threadId,
                occurredAt: now,
                payload: {
                  id: TurnItemId.make(`system:worktree-restored:${eventId}`),
                  threadId,
                  runId: null,
                  nodeId: null,
                  providerThreadId: null,
                  providerTurnId: null,
                  nativeItemRef: null,
                  parentItemId: null,
                  ordinal: yield* projections.getNextTurnItemOrdinal(threadId),
                  type: "system_notice",
                  status: "completed",
                  title: "Rebuilt this thread's worktree",
                  message: `The folder ${cwd} was missing. T3 Code checks out ${thread.branch} there again. This folder excludes uncommitted work.`,
                  startedAt: now,
                  completedAt: now,
                  updatedAt: now,
                },
              },
            ],
          });
        }),
      );
    },
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause)
        : Effect.logWarning("Could not rebuild the missing thread worktree.", { cause }),
    ),
  );
});

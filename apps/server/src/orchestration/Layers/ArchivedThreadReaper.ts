// @effect-diagnostics nodeBuiltinImport:off
/**
 * ArchivedThreadReaper - deletes archived threads once a day and removes the
 * worktree each one owns.
 *
 * Archiving takes a thread out of the sidebar but keeps its row and its
 * worktree path. Nothing ever removes either, so a retired thread holds its
 * checkout, its containers and its volumes for as long as the database lives,
 * and a thread whose worktree was removed by hand keeps pointing at a folder
 * that is gone.
 *
 * The sweep runs behind `deleteArchivedThreadsNightly`, which is off by
 * default because deleting a thread cannot be undone.
 *
 * A thread records the path its worktree had, not proof that T3 made it, so the
 * sweep removes a folder only when it sits inside the server's `worktreesDir`.
 * See `isManagedWorktree`.
 *
 * @module ArchivedThreadReaper
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { CommandId, type ProjectId, type ThreadId } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";

import * as ServerConfig from "../../config.ts";
import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import { WorktreeArchiveScriptRunner } from "../../project/WorktreeArchiveScriptRunner.ts";
import { forkParked } from "../../serverActivation.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  ArchivedThreadReaper,
  type ArchivedThreadReaperShape,
} from "../Services/ArchivedThreadReaper.ts";

/** How long the sweep waits before it is willing to run again. */
const DEFAULT_SWEEP_PERIOD = Duration.hours(24);

/**
 * The tick only has to be fine enough to notice that the sweep period has
 * passed. Keeping it well under that period also makes turning the setting on
 * take effect within the hour instead of a day later.
 */
const DEFAULT_TICK_INTERVAL = Duration.hours(1);

export interface ArchivedThreadReaperLiveOptions {
  readonly tickInterval?: Duration.Duration;
  readonly sweepPeriod?: Duration.Duration;
}

const worktreeExists = (path: string): boolean => {
  try {
    return NodeFS.statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/**
 * The real location of `value`, with every symbolic link followed.
 *
 * A worktree removed by hand no longer exists, and a path that is not there
 * cannot be resolved. Its parent almost always still is, so the parent is
 * resolved instead and the last segment put back. That step matters on macOS,
 * where the temporary and home folders are themselves links: comparing an
 * unresolved `/var/…` against a resolved `/private/var/…` never matches, and
 * every removed worktree would then read as somebody else's.
 *
 * When neither the path nor its parent resolves, the plain resolved form comes
 * back. It will not sit inside the managed folder, so the caller refuses to
 * touch it, which is the safe direction.
 */
const canonicalPath = (value: string): string => {
  const resolved = NodePath.resolve(value);
  try {
    return NodeFS.realpathSync(resolved);
  } catch {
    try {
      const parent = NodeFS.realpathSync(NodePath.dirname(resolved));
      return NodePath.join(parent, NodePath.basename(resolved));
    } catch {
      return resolved;
    }
  }
};

/**
 * Whether `worktreePath` sits inside `managedRoot`, and may therefore be taken
 * apart.
 *
 * A thread stores whatever path its worktree had, and that path can name any
 * folder on the disk. Only the ones inside the server's `worktreesDir` were
 * made by T3. Removing anything else destroys a folder somebody else depends
 * on, which is what happened to George's maintained fork checkout in August
 * 2026: two nightly sweeps ran `git worktree remove` against it, and each one
 * left that checkout with 140 tracked files deleted.
 *
 * Both sides are resolved through the filesystem first, so a link inside the
 * managed folder cannot stand in for a folder outside it. Containment is then
 * decided with `path.relative` rather than by comparing text, because a
 * sibling named `worktrees-elsewhere` shares the managed folder's spelling
 * without being inside it. The managed folder itself is not a worktree, so an
 * empty result is refused along with everything above it.
 */
const isManagedWorktree = (managedRoot: string, worktreePath: string): boolean => {
  const relative = NodePath.relative(managedRoot, canonicalPath(worktreePath));
  const climbsOut = relative === ".." || relative.startsWith(`..${NodePath.sep}`);
  return relative !== "" && !climbsOut && !NodePath.isAbsolute(relative);
};

const makeArchivedThreadReaper = (options?: ArchivedThreadReaperLiveOptions) =>
  Effect.gen(function* () {
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const orchestrationEngine = yield* OrchestrationEngineService;
    const serverSettings = yield* ServerSettingsService;
    const gitWorkflow = yield* GitWorkflowService;
    const archiveScriptRunner = yield* WorktreeArchiveScriptRunner;
    const crypto = yield* Crypto.Crypto;
    const config = yield* ServerConfig.ServerConfig;

    // The folder T3 manages does not move while the server runs, so it is
    // resolved once here rather than once per thread on every sweep.
    const managedRoot = canonicalPath(config.worktreesDir);

    const tickInterval = options?.tickInterval ?? DEFAULT_TICK_INTERVAL;
    const sweepPeriodMs = Duration.toMillis(options?.sweepPeriod ?? DEFAULT_SWEEP_PERIOD);
    const lastSweptAt = yield* Ref.make<number | null>(null);

    const commandId = crypto.randomUUIDv4.pipe(
      Effect.map((uuid) => CommandId.make(`server:archived-thread-reaper:${uuid}`)),
    );

    /**
     * Tears down the thread's worktree. Returns false when teardown failed, so
     * the thread survives to be retried on the next sweep rather than losing
     * the only record of which folder still needs cleaning.
     */
    const removeWorktreeFor = Effect.fn("ArchivedThreadReaper.removeWorktree")(function* (input: {
      readonly threadId: ThreadId;
      readonly worktreePath: string;
      readonly workspaceRoot: string;
    }) {
      // Ownership is settled before anything reads or runs inside the folder.
      // A refusal returns false, so the thread keeps its record of the path and
      // the sweep can try again; nothing in the folder is touched either way.
      if (!isManagedWorktree(managedRoot, input.worktreePath)) {
        yield* Effect.logWarning("orchestration.archived-thread.reaper.refused-foreign-worktree", {
          threadId: input.threadId,
          worktreePath: input.worktreePath,
          managedWorktreesDir: config.worktreesDir,
          detail:
            "T3 did not create this folder, so the sweep will not remove it. " +
            "Clear the thread's worktree path, or delete the thread by hand.",
        });
        return false;
      }

      // A worktree removed by hand is the common case here — most archived
      // threads on a long-lived install already point at nothing. There is no
      // folder to run a teardown script in and nothing for git to remove, so
      // the thread is free to go.
      if (!worktreeExists(input.worktreePath)) {
        yield* Effect.logDebug("orchestration.archived-thread.reaper.worktree-already-gone", {
          threadId: input.threadId,
          worktreePath: input.worktreePath,
        });
        return true;
      }

      const scriptOk = yield* archiveScriptRunner
        .run({ workspaceRoot: input.workspaceRoot, worktreePath: input.worktreePath })
        .pipe(
          Effect.as(true),
          Effect.catch((error) =>
            Effect.logWarning("orchestration.archived-thread.reaper.script-failed", {
              threadId: input.threadId,
              worktreePath: input.worktreePath,
              error,
            }).pipe(Effect.as(false)),
          ),
        );
      // Removing the folder after its teardown script failed would strand the
      // containers and volumes that script exists to stop, with the path they
      // are keyed to gone.
      if (!scriptOk) {
        return false;
      }

      return yield* gitWorkflow
        .removeWorktree({ cwd: input.workspaceRoot, path: input.worktreePath, force: true })
        .pipe(
          Effect.as(true),
          Effect.catch((error) =>
            Effect.logWarning("orchestration.archived-thread.reaper.remove-failed", {
              threadId: input.threadId,
              worktreePath: input.worktreePath,
              error,
            }).pipe(Effect.as(false)),
          ),
        );
    });

    const sweep = Effect.gen(function* () {
      const settings = yield* serverSettings.getSettings;
      if (!settings.deleteArchivedThreadsNightly) {
        return;
      }

      const now = yield* Clock.currentTimeMillis;
      const previous = yield* Ref.get(lastSweptAt);
      // A null previous is a server that just started, which sweeps on its
      // first tick rather than waiting out a whole period.
      if (previous !== null && now - previous < sweepPeriodMs) {
        return;
      }

      const snapshot = yield* projectionSnapshotQuery.getArchivedShellSnapshot();
      const workspaceRoots = new Map<ProjectId, string>(
        snapshot.projects.map((project) => [project.id, project.workspaceRoot]),
      );

      let deletedCount = 0;
      let skippedCount = 0;

      for (const thread of snapshot.threads) {
        if (thread.archivedAt === null) {
          continue;
        }

        // Archiving does not stop the agent, so an archived thread can still
        // have one running. An unattended sweep must not delete the thread out
        // from under live work.
        const sessionStatus = thread.session?.status;
        if (sessionStatus === "running" || sessionStatus === "starting") {
          yield* Effect.logInfo("orchestration.archived-thread.reaper.skipped-live-session", {
            threadId: thread.id,
            sessionStatus,
          });
          skippedCount += 1;
          continue;
        }

        if (thread.worktreePath !== null) {
          const workspaceRoot = workspaceRoots.get(thread.projectId);
          if (workspaceRoot === undefined) {
            yield* Effect.logWarning("orchestration.archived-thread.reaper.no-workspace-root", {
              threadId: thread.id,
              projectId: thread.projectId,
              worktreePath: thread.worktreePath,
            });
            skippedCount += 1;
            continue;
          }
          const removed = yield* removeWorktreeFor({
            threadId: thread.id,
            worktreePath: thread.worktreePath,
            workspaceRoot,
          });
          if (!removed) {
            skippedCount += 1;
            continue;
          }
        }

        const deleted = yield* commandId.pipe(
          Effect.flatMap((id) =>
            orchestrationEngine.dispatch({
              type: "thread.delete",
              commandId: id,
              threadId: thread.id,
            }),
          ),
          Effect.as(true),
          Effect.catch((error) =>
            Effect.logWarning("orchestration.archived-thread.reaper.delete-failed", {
              threadId: thread.id,
              error,
            }).pipe(Effect.as(false)),
          ),
        );

        if (deleted) {
          deletedCount += 1;
        } else {
          skippedCount += 1;
        }
      }

      // Recorded even when nothing was deleted: a sweep that found no work and
      // a sweep that never ran look identical without it.
      yield* Ref.set(lastSweptAt, now);
      yield* Effect.logInfo("orchestration.archived-thread.reaper.sweep-complete", {
        archivedCount: snapshot.threads.length,
        deletedCount,
        skippedCount,
      });
    });

    const start: ArchivedThreadReaperShape["start"] = () =>
      Effect.gen(function* () {
        yield* forkParked(
          sweep.pipe(
            Effect.catch((error: unknown) =>
              Effect.logWarning("orchestration.archived-thread.reaper.sweep-failed", { error }),
            ),
            Effect.catchDefect((defect: unknown) =>
              Effect.logWarning("orchestration.archived-thread.reaper.sweep-defect", { defect }),
            ),
            Effect.repeat(Schedule.spaced(tickInterval)),
          ),
        );

        yield* Effect.logInfo("orchestration.archived-thread.reaper.started", {
          tickIntervalMs: Duration.toMillis(tickInterval),
        });
      });

    return { start } satisfies ArchivedThreadReaperShape;
  });

export const makeArchivedThreadReaperLive = (options?: ArchivedThreadReaperLiveOptions) =>
  Layer.effect(ArchivedThreadReaper, makeArchivedThreadReaper(options));

export const ArchivedThreadReaperLive = makeArchivedThreadReaperLive();

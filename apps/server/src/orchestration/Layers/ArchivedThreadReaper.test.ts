// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WorktreeArchiveScriptError,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { afterAll, afterEach, beforeEach } from "vite-plus/test";

import * as ServerConfig from "../../config.ts";
import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import { WorktreeArchiveScriptRunner } from "../../project/WorktreeArchiveScriptRunner.ts";
import * as ServerSettings from "../../serverSettings.ts";
import { ArchivedThreadReaper } from "../Services/ArchivedThreadReaper.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { makeArchivedThreadReaperLive } from "./ArchivedThreadReaper.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const PROJECT_ID = ProjectId.make("project-archived-reaper");
const WORKSPACE_ROOT = "/tmp/archived-reaper-workspace";

const modelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5-codex",
} as const;

type ThreadInput = {
  readonly id: string;
  readonly archived?: boolean;
  readonly worktreePath?: string | null;
  readonly sessionStatus?: "starting" | "running" | "ready" | "stopped" | "error";
};

const makeSnapshot = (threads: ReadonlyArray<ThreadInput>) => ({
  snapshotSequence: 0,
  updatedAt: NOW,
  projects: [
    {
      id: PROJECT_ID,
      title: "Archived Reaper Project",
      workspaceRoot: WORKSPACE_ROOT,
      defaultModelSelection: modelSelection,
      scripts: [],
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
  threads: threads.map((thread) => ({
    id: ThreadId.make(thread.id),
    projectId: PROJECT_ID,
    title: `Thread ${thread.id}`,
    modelSelection,
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
    branch: null,
    worktreePath: thread.worktreePath ?? null,
    latestTurn: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: thread.archived === false ? null : NOW,
    settledOverride: null,
    settledAt: null,
    session:
      thread.sessionStatus === undefined
        ? null
        : {
            threadId: ThreadId.make(thread.id),
            status: thread.sessionStatus,
            providerName: "claudeAgent" as const,
            providerInstanceId: ProviderInstanceId.make("claudeAgent"),
            runtimeMode: "full-access" as const,
            activeTurnId: null,
            lastError: null,
            updatedAt: NOW,
          },
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  })),
});

describe("ArchivedThreadReaper", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
    // Clear the managed folder too, so one test's worktrees cannot be seen by
    // the next. `beforeEach` puts the folder itself back.
    NodeFS.rmSync(MANAGED_ROOT, { recursive: true, force: true });
  });

  const makeTempDir = (label: string): string => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), `t3-archived-reaper-${label}-`));
    tempDirs.push(dir);
    return dir;
  };

  // The base directory T3 was told to use. `worktreesDir` hangs off it exactly
  // as deriveServerPaths builds it, so a folder under MANAGED_ROOT is one T3
  // created and owns, and anything else belongs to somebody else. It outlives
  // the per-test cleanup, so it is not registered with `tempDirs`.
  const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-archived-reaper-home-"));
  const MANAGED_ROOT = NodePath.join(baseDir, "worktrees");

  beforeEach(() => {
    NodeFS.mkdirSync(MANAGED_ROOT, { recursive: true });
  });

  afterAll(() => {
    NodeFS.rmSync(baseDir, { recursive: true, force: true });
  });

  /** A worktree T3 created, under the folder it manages. */
  const makeWorktree = (): string => NodeFS.mkdtempSync(NodePath.join(MANAGED_ROOT, "wt-"));

  /** A folder T3 never created, like George's maintained fork checkout. */
  const makeExternalWorktree = (): string => makeTempDir("external");

  const runSweep = (input: {
    readonly enabled: boolean;
    readonly threads: ReadonlyArray<ThreadInput>;
    readonly scriptFails?: boolean;
  }) => {
    const deletedThreadIds: string[] = [];
    const removedWorktreePaths: string[] = [];
    const scriptedWorktreePaths: string[] = [];

    const dispatch = (command: { readonly type: string; readonly threadId?: ThreadId }) => {
      if (command.type === "thread.delete" && command.threadId) {
        deletedThreadIds.push(String(command.threadId));
      }
      return Effect.succeed({ sequence: deletedThreadIds.length });
    };

    const layer = makeArchivedThreadReaperLive({
      // One tick, run immediately by Effect.repeat, is all a test needs. The
      // long spacing keeps a second sweep from racing the assertions.
      tickInterval: Duration.minutes(10),
    }).pipe(
      Layer.provideMerge(
        Layer.mock(ProjectionSnapshotQuery)({
          getArchivedShellSnapshot: () => Effect.succeed(makeSnapshot(input.threads)),
        }),
      ),
      Layer.provideMerge(
        Layer.mock(OrchestrationEngineService)({
          dispatch: dispatch as never,
        }),
      ),
      Layer.provideMerge(
        Layer.mock(GitWorkflowService)({
          removeWorktree: (removeInput: { readonly path: string }) =>
            Effect.sync(() => {
              removedWorktreePaths.push(removeInput.path);
            }) as never,
        }),
      ),
      Layer.provideMerge(
        Layer.mock(WorktreeArchiveScriptRunner)({
          run: (runInput: { readonly worktreePath: string }) => {
            scriptedWorktreePaths.push(runInput.worktreePath);
            return input.scriptFails === true
              ? Effect.fail(
                  new WorktreeArchiveScriptError({
                    scriptName: "teardown",
                    command: "false",
                    worktreePath: runInput.worktreePath,
                    timedOut: false,
                    stdout: "",
                    stderr: "boom",
                    exitCode: 1,
                  }),
                )
              : Effect.succeed({ status: "ok" as const, scriptName: "teardown" });
          },
        }),
      ),
      Layer.provideMerge(ServerSettings.layerTest({ deleteArchivedThreadsNightly: input.enabled })),
      Layer.provideMerge(ServerConfig.layerTest(WORKSPACE_ROOT, baseDir)),
      Layer.provideMerge(NodeServices.layer),
    );

    return Effect.gen(function* () {
      const reaper = yield* ArchivedThreadReaper;
      yield* reaper.start();
      // The repeat schedule runs the sweep before its first wait, so the work
      // is queued as soon as start returns; yield until it drains. A real sleep
      // would hang here, because the test clock never advances on its own, so
      // every check the sweep makes on the disk stays synchronous.
      yield* Effect.forEach(Array.from({ length: 40 }), () => Effect.yieldNow, {
        discard: true,
      });
      return { deletedThreadIds, removedWorktreePaths, scriptedWorktreePaths };
    }).pipe(Effect.provide(layer), Effect.scoped);
  };

  it.effect("deletes nothing while the setting is off", () =>
    Effect.gen(function* () {
      const result = yield* runSweep({
        enabled: false,
        threads: [{ id: "thread-off", worktreePath: makeWorktree() }],
      });

      assert.deepEqual(result.deletedThreadIds, []);
      assert.deepEqual(result.removedWorktreePaths, []);
      assert.deepEqual(result.scriptedWorktreePaths, []);
    }),
  );

  it.effect("deletes an archived thread whose worktree was already removed by hand", () =>
    Effect.gen(function* () {
      const gone = makeWorktree();
      NodeFS.rmSync(gone, { recursive: true, force: true });

      const result = yield* runSweep({
        enabled: true,
        threads: [{ id: "thread-gone", worktreePath: gone }],
      });

      assert.deepEqual(result.deletedThreadIds, ["thread-gone"]);
      // There is no folder to tear down, so neither the script nor git runs.
      assert.deepEqual(result.scriptedWorktreePaths, []);
      assert.deepEqual(result.removedWorktreePaths, []);
    }),
  );

  it.effect("runs the teardown script, removes the worktree, then deletes the thread", () =>
    Effect.gen(function* () {
      const worktreePath = makeWorktree();

      const result = yield* runSweep({
        enabled: true,
        threads: [{ id: "thread-live-worktree", worktreePath }],
      });

      assert.deepEqual(result.scriptedWorktreePaths, [worktreePath]);
      assert.deepEqual(result.removedWorktreePaths, [worktreePath]);
      assert.deepEqual(result.deletedThreadIds, ["thread-live-worktree"]);
    }),
  );

  it.effect("keeps the thread and the worktree when the teardown script fails", () =>
    Effect.gen(function* () {
      const worktreePath = makeWorktree();

      const result = yield* runSweep({
        enabled: true,
        threads: [{ id: "thread-script-fails", worktreePath }],
        scriptFails: true,
      });

      assert.deepEqual(result.scriptedWorktreePaths, [worktreePath]);
      // Removing the folder now would strand whatever the script failed to stop.
      assert.deepEqual(result.removedWorktreePaths, []);
      assert.deepEqual(result.deletedThreadIds, []);
    }),
  );

  it.effect("skips an archived thread whose agent is still running", () =>
    Effect.gen(function* () {
      const result = yield* runSweep({
        enabled: true,
        threads: [
          { id: "thread-running", worktreePath: makeWorktree(), sessionStatus: "running" },
          { id: "thread-starting", worktreePath: makeWorktree(), sessionStatus: "starting" },
          { id: "thread-idle", worktreePath: makeWorktree(), sessionStatus: "ready" },
        ],
      });

      assert.deepEqual(result.deletedThreadIds, ["thread-idle"]);
    }),
  );

  it.effect("leaves a thread that is not archived alone", () =>
    Effect.gen(function* () {
      const result = yield* runSweep({
        enabled: true,
        threads: [{ id: "thread-active", archived: false, worktreePath: makeWorktree() }],
      });

      assert.deepEqual(result.deletedThreadIds, []);
      assert.deepEqual(result.removedWorktreePaths, []);
    }),
  );

  // On 7 and 8 August 2026 this sweep ran `git worktree remove` against
  // George's maintained fork checkout, which lives in ~/Development and which
  // T3 never created. The command exceeded its time limit part way through and
  // left 140 tracked files deleted. A thread may name any folder on the disk;
  // only the ones under the folder T3 manages are T3's to take apart.
  describe("worktrees it does not own", () => {
    const refuses = (label: string, makePath: () => string) =>
      it.effect(label, () =>
        Effect.gen(function* () {
          const worktreePath = makePath();

          const result = yield* runSweep({
            enabled: true,
            threads: [{ id: "thread-foreign", worktreePath }],
          });

          // Nothing ran inside the folder, so nothing in it can be damaged.
          assert.deepEqual(result.scriptedWorktreePaths, []);
          assert.deepEqual(result.removedWorktreePaths, []);
          // The thread stays archived, so the sweep can try again once the
          // path becomes one T3 owns, or once somebody fixes the record.
          assert.deepEqual(result.deletedThreadIds, []);
        }),
      );

    refuses("refuses a checkout outside the managed folder", makeExternalWorktree);

    refuses("refuses the managed folder itself", () => MANAGED_ROOT);

    refuses("refuses a sibling folder whose name merely starts the same", () => {
      const sibling = `${MANAGED_ROOT}-elsewhere`;
      NodeFS.mkdirSync(sibling, { recursive: true });
      tempDirs.push(sibling);
      return sibling;
    });

    refuses("refuses a path that climbs back out with ..", () => {
      const escaped = makeExternalWorktree();
      return NodePath.join(MANAGED_ROOT, "..", NodePath.basename(escaped));
    });

    refuses("refuses a link inside the managed folder that points outside it", () => {
      const target = makeExternalWorktree();
      const link = NodePath.join(MANAGED_ROOT, "link-to-elsewhere");
      NodeFS.symlinkSync(target, link);
      return link;
    });
  });

  it.effect("still removes a worktree inside the managed folder", () =>
    Effect.gen(function* () {
      const worktreePath = makeWorktree();

      const result = yield* runSweep({
        enabled: true,
        threads: [{ id: "thread-managed", worktreePath }],
      });

      assert.deepEqual(result.scriptedWorktreePaths, [worktreePath]);
      assert.deepEqual(result.removedWorktreePaths, [worktreePath]);
      assert.deepEqual(result.deletedThreadIds, ["thread-managed"]);
    }),
  );
});

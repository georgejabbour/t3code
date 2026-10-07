// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  RunId,
  RuntimeRequestId,
  type OrchestrationV2ThreadShell,
  type OrchestrationV2ThreadShellSnapshot,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Queue from "effect/Queue";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { TestClock } from "effect/testing";
import { afterEach } from "vite-plus/test";

import { ServerSettingsService } from "../../serverSettings.ts";
import { ServerActivation } from "../../serverActivation.ts";
import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import { ArchivedThreadReaper } from "../Services/ArchivedThreadReaper.ts";
import { makeArchivedThreadReaperLive } from "./ArchivedThreadReaper.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const PROJECT_ID = ProjectId.make("project-archived-reaper");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" };

type ThreadInput = {
  readonly id: string;
  readonly archived?: boolean;
  readonly worktreePath?: string | null;
  readonly sessionStatus?: "starting" | "running" | "ready" | "stopped" | "error";
};
const makeSnapshot = (threads: ReadonlyArray<ThreadInput>): OrchestrationV2ThreadShellSnapshot => ({
  schemaVersion: 2,
  snapshotSequence: 0,
  threads: [],
  archivedThreads: threads.map((thread) => {
    const id = ThreadId.make(thread.id);
    const status =
      thread.sessionStatus === "starting" || thread.sessionStatus === "running"
        ? thread.sessionStatus
        : "idle";
    const now = DateTime.makeUnsafe(NOW);
    return {
      id,
      projectId: PROJECT_ID,
      title: `Thread ${thread.id}`,
      providerInstanceId: modelSelection.instanceId,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: thread.worktreePath ?? null,
      activeProviderThreadId: null,
      lineage: { rootThreadId: id, parentThreadId: null, relationshipToParent: null },
      forkedFrom: null,
      createdBy: "user",
      creationSource: "web",
      latestRunId: null,
      activeRunId: status === "idle" ? null : RunId.make(`run:${id}`),
      status,
      pendingRuntimeRequest: null,
      latestVisibleMessage: null,
      latestUserMessageAt: null,
      hasActionableProposedPlan: false,
      itemCount: 0,
      visibleItemCount: 0,
      createdAt: now,
      updatedAt: now,
      archivedAt: thread.archived === false ? null : now,
      settledOverride: null,
      settledAt: null,
      deletedAt: null,
    };
  }),
});

const makeThread = (
  id: string,
  overrides: Partial<OrchestrationV2ThreadShell> = {},
): OrchestrationV2ThreadShell => ({
  ...makeSnapshot([{ id }]).archivedThreads[0]!,
  ...overrides,
});

const runSweep = (input: {
  readonly enabled?: boolean;
  readonly threads: ReadonlyArray<OrchestrationV2ThreadShell>;
  readonly failFirstDelete?: boolean;
  readonly advanceHours?: number;
  readonly parkUntilActivated?: boolean;
}) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse(NOW));
    const ticks = yield* Queue.unbounded<void>();
    const activation = yield* Deferred.make<void>();
    const deleted: string[] = [];
    const attempted: string[] = [];
    let snapshotReads = 0;
    const layer = makeArchivedThreadReaperLive({ tickInterval: Duration.hours(24) }).pipe(
      Layer.provideMerge(
        Layer.mock(Orchestrator.OrchestratorV2)({
          getShellSnapshot: () =>
            Effect.sync(() => {
              snapshotReads += 1;
              return {
                schemaVersion: 2 as const,
                snapshotSequence: 0,
                threads: [],
                archivedThreads: input.threads,
              };
            }),
          dispatch: (command) => {
            if (command.type !== "thread.delete") return Effect.die("unexpected command");
            assert.strictEqual(DateTime.formatIso(command.expectedArchivedAt!), NOW);
            attempted.push(command.threadId);
            if (input.failFirstDelete && attempted.length === 1) {
              return Effect.fail(
                new Orchestrator.OrchestratorDispatchError({
                  commandId: command.commandId,
                  commandType: command.type,
                  cause: "retryable deletion failure",
                }),
              );
            }
            deleted.push(command.threadId);
            return Effect.succeed({ sequence: deleted.length, storedEvents: [] });
          },
        }),
      ),
      Layer.provideMerge(
        Layer.mock(ServerSettingsService)({
          getSettings: Queue.offer(ticks, undefined).pipe(
            Effect.as({
              ...DEFAULT_SERVER_SETTINGS,
              deleteArchivedThreadsNightly: input.enabled ?? true,
            }),
          ),
        }),
      ),
      Layer.provideMerge(NodeServices.layer),
    );
    return yield* Effect.gen(function* () {
      const reaper = yield* ArchivedThreadReaper;
      yield* reaper.start();
      if (input.parkUntilActivated) {
        yield* reaper.drain;
        assert.deepEqual(attempted, []);
        assert.strictEqual(snapshotReads, 0);
        yield* Deferred.succeed(activation, undefined);
      }
      yield* Queue.take(ticks);
      yield* reaper.drain;
      if (input.advanceHours !== undefined) {
        yield* TestClock.adjust(Duration.hours(input.advanceHours));
        if (input.advanceHours >= 24) yield* Queue.take(ticks);
        yield* reaper.drain;
      }
      return { deleted, attempted, snapshotReads };
    }).pipe(
      Effect.provide(layer),
      Effect.provideService(
        ServerActivation,
        input.parkUntilActivated ? Deferred.await(activation) : undefined,
      ),
      Effect.scoped,
    );
  });

describe("ArchivedThreadReaper", () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    for (const directory of tempDirs.splice(0)) {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });

  it.effect("parks deletion until the server activates", () =>
    Effect.gen(function* () {
      const result = yield* runSweep({ threads: [makeThread("parked")], parkUntilActivated: true });
      assert.deepEqual(result.deleted, ["parked"]);
    }),
  );

  it.effect("leaves conversations untouched while disabled", () =>
    Effect.gen(function* () {
      const result = yield* runSweep({ enabled: false, threads: [makeThread("disabled")] });
      assert.deepEqual(result.deleted, []);
      assert.strictEqual(result.snapshotReads, 0);
    }),
  );

  it.effect("deletes history without reading or changing worktree folders", () =>
    Effect.gen(function* () {
      const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-reaper-history-"));
      tempDirs.push(directory);
      const localFile = NodePath.join(directory, "uncommitted.txt");
      NodeFS.writeFileSync(localFile, "keep my work");
      const result = yield* runSweep({
        threads: [
          makeThread("first-owner", { worktreePath: directory }),
          makeThread("second-owner", { worktreePath: directory }),
          makeThread("missing-folder", { worktreePath: NodePath.join(directory, "missing") }),
          makeThread("no-folder"),
          makeThread("active", { archivedAt: null, worktreePath: directory }),
        ],
      });
      assert.deepEqual(result.deleted, [
        "first-owner",
        "second-owner",
        "missing-folder",
        "no-folder",
      ]);
      assert.strictEqual(NodeFS.readFileSync(localFile, "utf8"), "keep my work");
    }),
  );

  it.effect("retains conversations with active or pending work", () =>
    Effect.gen(function* () {
      const result = yield* runSweep({
        threads: [
          makeThread("running", { activeRunId: RunId.make("active"), status: "running" }),
          makeThread("starting", { status: "starting" }),
          makeThread("queued", { status: "queued" }),
          makeThread("approval", {
            pendingRuntimeRequest: {
              id: RuntimeRequestId.make("request:approval"),
              kind: "permission",
              createdAt: DateTime.makeUnsafe(NOW),
            },
          }),
          makeThread("question", {
            pendingRuntimeRequest: {
              id: RuntimeRequestId.make("request:question"),
              kind: "user_input",
              createdAt: DateTime.makeUnsafe(NOW),
            },
          }),
          makeThread("background", {
            pendingBackgroundTasks: [{ taskId: "command", kind: "command" }],
          }),
          makeThread("monitoring", {
            pendingBackgroundTasks: [{ taskId: "monitor", kind: "monitor" }],
          }),
          makeThread("idle"),
        ],
      });
      assert.deepEqual(result.deleted, ["idle"]);
    }),
  );

  it.effect("waits a full day before the next sweep", () =>
    Effect.gen(function* () {
      const result = yield* runSweep({ threads: [], advanceHours: 23 });
      assert.strictEqual(result.snapshotReads, 1);
    }),
  );

  it.effect("retries failed deletion on the next daily sweep", () =>
    Effect.gen(function* () {
      const result = yield* runSweep({
        threads: [makeThread("retry")],
        failFirstDelete: true,
        advanceHours: 24,
      });
      assert.deepEqual(result.attempted, ["retry", "retry"]);
      assert.deepEqual(result.deleted, ["retry"]);
    }),
  );
});

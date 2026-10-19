// @effect-diagnostics nodeBuiltinImport:off -- Isolated filesystem and Git fixtures.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  ProjectId,
  RunId,
  ProviderDriverKind,
  type TerminalSummary,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";
import { afterEach } from "vite-plus/test";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as T3ProjectFileLoader from "../project/T3ProjectFileLoader.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import { withWorkspaceLease } from "../workspace/workspaceLease.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as EventSink from "./EventSink.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
import * as EffectWorker from "./EffectWorker.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";
import * as WorkspaceCleanup from "./WorkspaceCleanup.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    NodeFS.rmSync(directory, { recursive: true, force: true });
});
const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "gpt-5.4" };
const projectId = ProjectId.make("cleanup-project");
const adapter = ProviderAdapterRegistry.layerFromAdapters([
  {
    instanceId,
    driver: ProviderDriverKind.make("codex"),
    getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
    planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
    openSession: () => Effect.die("These archive tests never start a provider"),
  },
]);

const decodeCall = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      cwd: Schema.String,
      args: Schema.Array(Schema.String),
      root: Schema.String,
      workspace: Schema.String,
    }),
  ),
);

function fixture() {
  const directory = NodeFS.realpathSync(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-archive-cleanup-")),
  );
  directories.push(directory);
  const root = NodePath.join(directory, "root");
  const workspace = NodePath.join(directory, "workspace with ' quotes $() and spaces");
  NodeFS.mkdirSync(root);
  NodeFS.mkdirSync(workspace);
  NodeFS.writeFileSync(
    NodePath.join(root, "cleanup.mjs"),
    `
import { appendFileSync, existsSync } from 'node:fs';
appendFileSync('calls.jsonl', JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2), root: process.env.T3CODE_PROJECT_ROOT, workspace: process.env.T3CODE_WORKTREE_PATH }) + '\\n');
if (existsSync('fail')) { console.error('fixture cleanup failure'); process.exit(19); }
`,
  );
  NodeFS.writeFileSync(
    NodePath.join(root, "t3.json"),
    JSON.stringify({ workspaceCleanupCommand: "node cleanup.mjs" }),
  );
  // Old branches must never select either their root-cleanup setting or removal hook.
  NodeFS.writeFileSync(
    NodePath.join(workspace, "t3.json"),
    JSON.stringify({
      workspaceCleanupCommand: "exit 71",
      scripts: [{ name: "Old archive", command: "exit 72", runOnWorktreeRemove: true }],
    }),
  );
  return {
    directory,
    root,
    workspace,
    calls: () =>
      NodeFS.existsSync(NodePath.join(root, "calls.jsonl"))
        ? NodeFS.readFileSync(NodePath.join(root, "calls.jsonl"), "utf8")
            .trim()
            .split("\n")
            .map((line) => decodeCall(line))
        : [],
  };
}

function layerFixture(
  input: {
    beforeRun?: Effect.Effect<void>;
    dbPath?: string;
    terminals?: ReadonlyArray<TerminalSummary>;
    onExecute?: (effect: EffectOutbox.OrchestrationEffectV2) => Effect.Effect<void>;
  } = {},
) {
  const database = (
    input.dbPath === undefined
      ? SqlitePersistence.layerMemory
      : SqlitePersistence.layerFromPath(input.dbPath)
  ).pipe(Layer.provide(NodeServices.layer));
  const stores = Layer.mergeAll(ProjectStore.layer, EffectOutbox.layer, ProjectionStore.layer).pipe(
    Layer.provideMerge(database),
  );
  const harness = ProviderReplayHarness.layerWithRegistry({ name: "archive-cleanup" }, adapter, {
    databaseLayer: database,
    runEffectWorker: false,
  });
  const processes =
    input.beforeRun === undefined
      ? ProcessRunner.layer
      : Layer.effect(
          ProcessRunner.ProcessRunner,
          Effect.gen(function* () {
            const actual = yield* ProcessRunner.ProcessRunner;
            return ProcessRunner.ProcessRunner.of({
              run: (request) =>
                (input.beforeRun ?? Effect.void).pipe(Effect.andThen(actual.run(request))),
            });
          }),
        ).pipe(Layer.provide(ProcessRunner.layer));
  const subject = WorkspaceCleanup.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        stores,
        processes,
        T3ProjectFileLoader.layer,
        Layer.mock(TerminalManager.TerminalManager)({
          subscribeMetadata: (listener) =>
            listener({ type: "snapshot", terminals: input.terminals ?? [] }).pipe(
              Effect.as(() => {}),
            ),
        }),
      ),
    ),
  );
  const executor = Layer.effect(
    EffectWorker.OrchestrationEffectExecutorV2,
    Effect.gen(function* () {
      const cleanup = yield* WorkspaceCleanup.WorkspaceCleanup;
      return EffectWorker.OrchestrationEffectExecutorV2.of({
        execute: (effect) =>
          cleanup.execute(effect).pipe(
            Effect.andThen(input.onExecute?.(effect) ?? Effect.void),
            Effect.mapError(
              (cause) =>
                new EffectWorker.OrchestrationEffectExecutionError({
                  effectId: effect.id,
                  effectType: effect.request.type,
                  cause,
                }),
            ),
          ),
      });
    }),
  ).pipe(Layer.provide(subject));
  const worker = EffectWorker.layer.pipe(Layer.provide(Layer.merge(stores, executor)));
  return Layer.mergeAll(harness, stores, subject, worker).pipe(Layer.provide(NodeServices.layer));
}

const seedProject = (root: string, id = projectId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`INSERT INTO projection_projects
    (project_id, title, workspace_root, scripts_json, created_at, updated_at)
    VALUES (${id}, 'Cleanup', ${root}, '[]', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`;
  });
const create = (id: string, workspace: string | null, project = projectId) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    yield* orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make(`create:${id}`),
      threadId: ThreadId.make(id),
      projectId: project,
      title: id,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: workspace,
      createdBy: "user",
      creationSource: "web",
    });
  });
const archive = (id: string, generation = "1") =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    yield* orchestrator.dispatch({
      type: "thread.archive",
      commandId: CommandId.make(`archive:${id}:${generation}`),
      threadId: ThreadId.make(id),
    });
  });
const unarchive = (id: string) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    yield* orchestrator.dispatch({
      type: "thread.unarchive",
      commandId: CommandId.make(`unarchive:${id}`),
      threadId: ThreadId.make(id),
    });
  });
const drain = Effect.flatMap(EffectWorker.OrchestrationEffectWorkerV2, (worker) => worker.drain());

it.effect(
  "commits sibling archives and cleans once from root without changing the Git checkout",
  () => {
    const f = fixture();
    const git = (args: string[]) =>
      NodeChildProcess.execFileSync("git", args, { cwd: f.workspace, encoding: "utf8" });
    git(["init", "--initial-branch=main"]);
    git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "add", "t3.json"]);
    git([
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.com",
      "commit",
      "-m",
      "fixture",
      "--no-verify",
    ]);
    NodeFS.appendFileSync(NodePath.join(f.workspace, "t3.json"), "\n");
    NodeFS.writeFileSync(NodePath.join(f.workspace, "source.txt"), "preserve untracked source\n");
    const before = git(["status", "--porcelain=v1"]);
    return Effect.gen(function* () {
      yield* seedProject(f.root);
      yield* create("a", f.workspace);
      yield* create("b", f.workspace);
      yield* Effect.all([archive("a"), archive("b")], { concurrency: "unbounded" });
      yield* drain;
      assert.equal(f.calls().length, 1);
      assert.deepEqual(f.calls()[0], {
        cwd: f.root,
        root: f.root,
        workspace: f.workspace,
        args: ["--workspace-path", f.workspace],
      });
      assert.equal(git(["status", "--porcelain=v1"]), before);
      assert.equal(
        NodeFS.readFileSync(NodePath.join(f.workspace, "source.txt"), "utf8"),
        "preserve untracked source\n",
      );
      const outbox = yield* EffectOutbox.EffectOutboxV2;
      const effects = yield* outbox.listByCommandId(CommandId.make("archive:b:1"));
      assert.equal(
        effects.find((effect) => effect.request.type === "workspace.cleanup")?.status,
        "succeeded",
      );
      // Receipt replay cannot queue or run cleanup again.
      yield* archive("b");
      yield* drain;
      assert.equal(f.calls().length, 1);
    }).pipe(Effect.provide(layerFixture()));
  },
);

it.effect("preserves cross-project workspaces and canonical aliases until the last archive", () => {
  const f = fixture();
  const alias = NodePath.join(f.directory, "alias");
  const rootAlias = NodePath.join(f.directory, "root-alias");
  NodeFS.symlinkSync(f.workspace, alias, "dir");
  NodeFS.symlinkSync(f.root, rootAlias, "dir");
  const other = ProjectId.make("other-project");
  return Effect.gen(function* () {
    yield* seedProject(f.root);
    yield* seedProject(rootAlias, other);
    yield* create("a", f.workspace);
    yield* create("b", alias, other);
    yield* archive("a");
    yield* drain;
    assert.deepEqual(f.calls(), []);
    yield* archive("b");
    yield* drain;
    assert.equal(f.calls().length, 1);
  }).pipe(Effect.provide(layerFixture()));
});

it.effect("includes local threads in last-thread eligibility", () => {
  const f = fixture();
  return Effect.gen(function* () {
    yield* seedProject(f.root);
    yield* create("a", f.root);
    yield* create("local", null);
    yield* archive("a");
    yield* drain;
    assert.deepEqual(f.calls(), []);
    yield* archive("local");
    yield* drain;
    assert.equal(f.calls().length, 1);
    assert.equal(f.calls()[0]?.workspace, f.root);
  }).pipe(Effect.provide(layerFixture()));
});

it.effect("undo cancels pending cleanup and stale generations cannot run after rearchive", () => {
  const f = fixture();
  return Effect.gen(function* () {
    yield* seedProject(f.root);
    yield* create("a", f.workspace);
    yield* archive("a");
    const outbox = yield* EffectOutbox.EffectOutboxV2;
    yield* unarchive("a");
    const cancelled = yield* outbox.get("effect:archive:a:1:workspace.cleanup");
    assert.equal(Option.getOrThrow(cancelled).status, "cancelled");
    yield* archive("a", "2");
    const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
    yield* worker.runOnce; // second archive terminal cleanup
    const claimed = Option.getOrThrow(
      yield* outbox.claimNext({
        workerId: "fixture",
        leaseDurationMs: 1000,
        queue: "workspace-cleanup",
      }),
    );
    const cleanup = yield* WorkspaceCleanup.WorkspaceCleanup;
    const old = Option.getOrThrow(cancelled);
    // Even equal timestamps must not make the earlier command eligible.
    yield* cleanup.execute({ ...claimed, commandId: old.commandId, id: old.id });
    assert.deepEqual(f.calls(), []);
    yield* cleanup.execute(claimed);
    assert.equal(f.calls().length, 1);
  }).pipe(Effect.provide(layerFixture()));
});

it.effect(
  "runs cleanup for a missing workspace and passes the dry-run repository interface",
  () => {
    const f = fixture();
    NodeFS.rmSync(f.workspace, { recursive: true });
    return Effect.gen(function* () {
      yield* seedProject(f.root);
      yield* create("a", f.workspace);
      yield* archive("a");
      const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
      yield* worker.runOnce;
      const outbox = yield* EffectOutbox.EffectOutboxV2;
      const claimed = Option.getOrThrow(
        yield* outbox.claimNext({
          workerId: "dry-run",
          leaseDurationMs: 1000,
          queue: "workspace-cleanup",
        }),
      );
      const cleanup = yield* WorkspaceCleanup.WorkspaceCleanup;
      yield* cleanup.execute(claimed, { dryRun: true });
      assert.deepEqual(f.calls()[0]?.args, ["--workspace-path", f.workspace, "--dry-run"]);
      assert.isFalse(NodeFS.existsSync(f.workspace));
    }).pipe(Effect.provide(layerFixture()));
  },
);

it.effect("rejects a queued workspace alias that now points elsewhere", () => {
  const f = fixture();
  const alias = NodePath.join(f.directory, "alias");
  NodeFS.symlinkSync(f.workspace, alias, "dir");
  return Effect.gen(function* () {
    yield* seedProject(f.root);
    yield* create("a", alias);
    yield* archive("a");
    NodeFS.unlinkSync(alias);
    NodeFS.symlinkSync(f.root, alias, "dir");
    yield* drain;
    assert.deepEqual(f.calls(), []);
  }).pipe(Effect.provide(layerFixture()));
});

it.effect("persists failures and guards a retry against a new live workspace reference", () => {
  const f = fixture();
  NodeFS.writeFileSync(NodePath.join(f.root, "fail"), "fail once");
  return Effect.gen(function* () {
    yield* seedProject(f.root);
    yield* create("a", f.workspace);
    yield* archive("a");
    const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
    yield* worker.runOnce;
    yield* worker.runCleanupOnce;
    const outbox = yield* EffectOutbox.EffectOutboxV2;
    const failed = Option.getOrThrow(yield* outbox.get("effect:archive:a:1:workspace.cleanup"));
    assert.equal(failed.status, "pending");
    assert.include(failed.lastError ?? "", "Workspace cleanup failed (command), exit code 19");
    assert.include(failed.lastError ?? "", "fixture cleanup failure");
    assert.equal(failed.attemptCount, 1);
    NodeFS.unlinkSync(NodePath.join(f.root, "fail"));
    yield* create("new", f.workspace);
    yield* TestClock.adjust("100 millis");
    yield* worker.runCleanupOnce;
    assert.equal(f.calls().length, 1);
    const retried = Option.getOrThrow(yield* outbox.get(failed.id));
    assert.equal(retried.status, "succeeded");
    assert.equal(retried.attemptCount, 2);
  }).pipe(Effect.provide(layerFixture()));
});

it.effect("does not fall back to root removal hooks when cleanup is not configured", () => {
  const f = fixture();
  NodeFS.writeFileSync(
    NodePath.join(f.root, "t3.json"),
    JSON.stringify({
      scripts: [{ name: "Old", command: "node cleanup.mjs", runOnWorktreeRemove: true }],
    }),
  );
  return Effect.gen(function* () {
    yield* seedProject(f.root);
    yield* create("a", f.workspace);
    yield* archive("a");
    yield* drain;
    assert.deepEqual(f.calls(), []);
  }).pipe(Effect.provide(layerFixture()));
});

it.effect("replays a running cleanup from a disk SQLite fixture after restart", () => {
  const f = fixture();
  const dbPath = NodePath.join(f.directory, "fixture.sqlite");
  return Effect.gen(function* () {
    yield* Effect.scoped(
      Effect.gen(function* () {
        yield* seedProject(f.root);
        yield* create("a", f.workspace);
        yield* archive("a");
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        yield* worker.runOnce;
        const outbox = yield* EffectOutbox.EffectOutboxV2;
        assert.isTrue(
          Option.isSome(
            yield* outbox.claimNext({
              workerId: "lost-process",
              leaseDurationMs: 1000,
              queue: "workspace-cleanup",
            }),
          ),
        );
      }).pipe(Effect.provide(layerFixture({ dbPath }))),
    );
    yield* Effect.scoped(
      Effect.gen(function* () {
        const outbox = yield* EffectOutbox.EffectOutboxV2;
        const recovered = yield* outbox.reconcileAfterProcessLoss;
        assert.equal(recovered.requeued, 1);
        yield* drain;
        assert.equal(f.calls().length, 1);
        const effect = Option.getOrThrow(yield* outbox.get("effect:archive:a:1:workspace.cleanup"));
        assert.equal(effect.status, "succeeded");
        assert.equal(effect.attemptCount, 2);
      }).pipe(Effect.provide(layerFixture({ dbPath }))),
    );
  });
});

it.effect(
  "holds undo and startup behind cleanup while unrelated provider work keeps capacity",
  () => {
    const f = fixture();
    return Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const run = Effect.gen(function* () {
        yield* seedProject(f.root);
        yield* create("a", f.workspace);
        yield* archive("a");
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        yield* worker.runOnce;
        const cleanup = yield* worker.runCleanupOnce.pipe(Effect.forkChild);
        yield* Deferred.await(entered);
        const undo = yield* unarchive("a").pipe(Effect.forkChild);
        const started = yield* Deferred.make<void>();
        const startup = yield* withWorkspaceLease(
          NodePath.join(f.workspace, "nested"),
          Deferred.succeed(started, undefined),
        ).pipe(Effect.forkChild);
        // Recovery and lifecycle claims never consume slow cleanup work.
        assert.isFalse(yield* worker.runRecoveryOnce);
        const outbox = yield* EffectOutbox.EffectOutboxV2;
        yield* outbox.enqueue([
          {
            id: "provider-capacity",
            commandId: CommandId.make("provider-capacity"),
            threadId: ThreadId.make("unrelated"),
            request: { type: "terminal.cleanup" },
          },
        ]);
        assert.isTrue(yield* worker.runOnce);
        assert.isFalse(yield* Deferred.isDone(started));
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(cleanup);
        yield* Fiber.join(undo);
        yield* Fiber.join(startup);
        assert.isTrue(yield* Deferred.isDone(started));
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        assert.isNull((yield* projections.getThread(ThreadId.make("a"))).archivedAt);
        assert.equal(f.calls().length, 1);
      });
      yield* run.pipe(
        Effect.provide(
          layerFixture({
            beforeRun: Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
            ),
          }),
        ),
      );
    });
  },
);

it.effect("does not discard cleanup when a newer archived sibling changes workspace", () => {
  const f = fixture();
  const moved = NodePath.join(f.directory, "moved");
  NodeFS.mkdirSync(moved);
  return Effect.gen(function* () {
    yield* seedProject(f.root);
    yield* create("a", f.workspace);
    yield* create("b", f.workspace);
    yield* archive("a");
    yield* archive("b");
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    yield* orchestrator.dispatch({
      type: "thread.metadata.update",
      commandId: CommandId.make("move-b"),
      threadId: ThreadId.make("b"),
      worktreePath: moved,
    });
    yield* drain;
    assert.equal(f.calls().length, 1);
    assert.equal(f.calls()[0]?.workspace, f.workspace);
  }).pipe(Effect.provide(layerFixture()));
});

it.effect("checks checkpoint locations held by live threads in other workspaces", () => {
  const f = fixture();
  return Effect.gen(function* () {
    yield* seedProject(f.root);
    yield* create("a", f.workspace);
    yield* create("b", f.root);
    const sql = yield* SqlClient.SqlClient;
    yield* sql`INSERT INTO orchestration_v2_projection_checkpoint_scopes
      (scope_id, thread_id, node_id, kind, ordinal_within_parent, advances_app_run_count, created_at, payload_json)
      VALUES ('scope:reference', 'b', 'node:reference', 'manual', 0, 0, '2026-10-01T00:00:00.000Z', ${JSON.stringify({ cwd: f.workspace })})`;
    yield* archive("a");
    yield* drain;
    assert.deepEqual(f.calls(), []);
  }).pipe(Effect.provide(layerFixture()));
});

it.effect("keeps errored provider sessions as live references and retries after they stop", () => {
  const f = fixture();
  return Effect.gen(function* () {
    yield* seedProject(f.root);
    yield* create("a", f.workspace);
    yield* archive("a");
    const sql = yield* SqlClient.SqlClient;
    yield* sql`INSERT INTO orchestration_v2_projection_provider_sessions
      (provider_session_id, thread_id, provider, status, updated_at, payload_json)
      VALUES ('shared-session', NULL, 'codex', 'error', '2026-10-01T00:00:00.000Z', ${JSON.stringify({ cwd: f.workspace })})`;
    yield* drain;
    assert.deepEqual(f.calls(), []);
    yield* sql`UPDATE orchestration_v2_projection_provider_sessions SET status = 'stopped' WHERE provider_session_id = 'shared-session'`;
    yield* TestClock.adjust("100 millis");
    yield* drain;
    assert.equal(f.calls().length, 1);
  }).pipe(Effect.provide(layerFixture()));
});

it.effect("keeps a terminal's cwd and workspace path as live references", () => {
  const f = fixture();
  const terminal: TerminalSummary = {
    threadId: "external",
    terminalId: "default",
    cwd: f.root,
    worktreePath: f.workspace,
    status: "running",
    pid: 12345,
    exitCode: null,
    exitSignal: null,
    hasRunningSubprocess: true,
    label: "fixture",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
  return Effect.gen(function* () {
    yield* seedProject(f.root);
    yield* create("a", f.workspace);
    yield* archive("a");
    yield* drain;
    assert.deepEqual(f.calls(), []);
    const outbox = yield* EffectOutbox.EffectOutboxV2;
    assert.include(
      Option.getOrThrow(yield* outbox.get("effect:archive:a:1:workspace.cleanup")).lastError ?? "",
      "busy",
    );
  }).pipe(Effect.provide(layerFixture({ terminals: [terminal] })));
});

it.effect(
  "waits for archive prerequisites and never consumes cleanup during recovery claims",
  () => {
    const f = fixture();
    return Effect.gen(function* () {
      yield* seedProject(f.root);
      yield* create("a", f.workspace);
      yield* archive("a");
      const outbox = yield* EffectOutbox.EffectOutboxV2;
      assert.isTrue(
        Option.isNone(
          yield* outbox.claimNext({
            workerId: "early",
            leaseDurationMs: 1000,
            queue: "workspace-cleanup",
          }),
        ),
      );
      const terminal = Option.getOrThrow(
        yield* outbox.claimNext({
          workerId: "terminal",
          leaseDurationMs: 1000,
          queue: "lifecycle",
        }),
      );
      yield* outbox.fail({
        effectId: terminal.id,
        workerId: "terminal",
        error: "fixture shutdown failed",
      });
      assert.isTrue(
        Option.isNone(
          yield* outbox.claimNext({
            workerId: "early",
            leaseDurationMs: 1000,
            queue: "workspace-cleanup",
          }),
        ),
      );
      const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
      assert.isFalse(yield* worker.runRecoveryOnce);
      assert.deepEqual(f.calls(), []);
    }).pipe(Effect.provide(layerFixture()));
  },
);

it.effect("holds project root moves behind running cleanup", () => {
  const f = fixture();
  const other = ProjectId.make("other");
  const otherRoot = NodePath.join(f.directory, "other-root");
  NodeFS.mkdirSync(otherRoot);
  return Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    yield* Effect.gen(function* () {
      yield* seedProject(f.root);
      yield* seedProject(otherRoot, other);
      yield* create("a", f.workspace);
      yield* create("local", null, other);
      yield* archive("a");
      const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
      yield* worker.runOnce;
      const cleaning = yield* worker.runCleanupOnce.pipe(Effect.forkChild);
      yield* Deferred.await(entered);
      const sink = yield* EventSink.EventSinkV2;
      const now = yield* DateTime.now;
      const moved = yield* sink
        .commitProjectCommand({
          commandId: CommandId.make("move-project"),
          projectId: other,
          commandType: "project.meta.update",
          acceptedAt: now,
          event: {
            type: "project.meta-updated",
            eventId: EventId.make("move-project-event"),
            aggregateKind: "project",
            aggregateId: other,
            occurredAt: DateTime.formatIso(now),
            commandId: CommandId.make("move-project"),
            causationEventId: null,
            correlationId: null,
            metadata: {},
            payload: {
              projectId: other,
              workspaceRoot: f.workspace,
              updatedAt: DateTime.formatIso(now),
            },
          },
        })
        .pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      const projects = yield* ProjectStore.ProjectStoreV2;
      assert.equal(Option.getOrThrow(yield* projects.get(other)).workspaceRoot, otherRoot);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(cleaning);
      yield* Fiber.join(moved);
      assert.equal(Option.getOrThrow(yield* projects.get(other)).workspaceRoot, f.workspace);
      assert.equal(f.calls().length, 1);
    }).pipe(
      Effect.provide(
        layerFixture({
          beforeRun: Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
          ),
        }),
      ),
    );
  });
});

it.effect("reserves daemon capacity for provider work while archive cleanup is blocked", () => {
  const f = fixture();
  return Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    const providerRan = yield* Deferred.make<void>();
    yield* Effect.gen(function* () {
      yield* seedProject(f.root);
      yield* create("a", f.workspace);
      yield* archive("a");
      const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
      yield* worker.runOnce;
      // Startup recovery must leave runnable cleanup to its background worker.
      assert.isFalse(yield* worker.runRecoveryOnce);
      const daemon = yield* EffectWorker.runDaemonWithOptions({ concurrency: 1 }).pipe(
        Effect.forkChild,
      );
      yield* Deferred.await(entered);
      const outbox = yield* EffectOutbox.EffectOutboxV2;
      yield* outbox.enqueue([
        {
          id: "daemon-provider-capacity",
          commandId: CommandId.make("daemon-capacity"),
          threadId: ThreadId.make("unrelated"),
          request: { type: "provider-turn.start", runId: RunId.make("unrelated") },
        },
      ]);
      yield* outbox.notifyAvailable();
      yield* Deferred.await(providerRan);
      assert.deepEqual(f.calls(), []);
      // Interrupt the fixture before any external script starts.
      yield* Fiber.interrupt(daemon);
    }).pipe(
      Effect.provide(
        layerFixture({
          beforeRun: Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
          onExecute: (effect) =>
            effect.id === "daemon-provider-capacity"
              ? Deferred.succeed(providerRan, undefined).pipe(Effect.asVoid)
              : Effect.void,
        }),
      ),
    );
  });
});

it.effect(
  "waits for sibling shutdown even when that sibling changes its archived workspace",
  () => {
    const f = fixture();
    const moved = NodePath.join(f.directory, "moved");
    NodeFS.mkdirSync(moved);
    return Effect.gen(function* () {
      yield* seedProject(f.root);
      yield* create("a", f.workspace);
      yield* create("b", f.workspace);
      yield* archive("a");
      yield* archive("b");
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      yield* orchestrator.dispatch({
        type: "thread.metadata.update",
        commandId: CommandId.make("move-b"),
        threadId: ThreadId.make("b"),
        worktreePath: moved,
      });
      const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
      yield* worker.runOnce;
      const outbox = yield* EffectOutbox.EffectOutboxV2;
      const sibling = Option.getOrThrow(
        yield* outbox.claimNext({
          workerId: "shutdown",
          leaseDurationMs: 1000,
          queue: "lifecycle",
        }),
      );
      assert.isTrue(
        Option.isNone(
          yield* outbox.claimNext({
            workerId: "cleanup",
            leaseDurationMs: 1000,
            queue: "workspace-cleanup",
          }),
        ),
      );
      yield* outbox.succeed({ effectId: sibling.id, workerId: "shutdown" });
      yield* drain;
      assert.equal(f.calls().length, 1);
    }).pipe(Effect.provide(layerFixture()));
  },
);

it.effect("does not let a cancelled archive generation block a later cleanup retry", () => {
  const f = fixture();
  return Effect.gen(function* () {
    yield* seedProject(f.root);
    yield* create("a", f.workspace);
    yield* archive("a");
    const outbox = yield* EffectOutbox.EffectOutboxV2;
    const old = Option.getOrThrow(
      yield* outbox.claimNext({
        workerId: "old-shutdown",
        leaseDurationMs: 1000,
        queue: "lifecycle",
      }),
    );
    yield* outbox.fail({
      effectId: old.id,
      workerId: "old-shutdown",
      error: "old shutdown failure",
    });
    yield* unarchive("a");
    yield* archive("a", "2");
    yield* drain;
    assert.equal(f.calls().length, 1);
    assert.equal(
      Option.getOrThrow(yield* outbox.get("effect:archive:a:2:workspace.cleanup")).status,
      "succeeded",
    );
  }).pipe(Effect.provide(layerFixture()));
});

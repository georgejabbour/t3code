// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ThreadId,
  OrchestrationV2ProviderSessionJson,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { afterEach } from "vite-plus/test";

import * as ServerConfig from "./config.ts";
import * as GitManager from "./git/GitManager.ts";
import { CodexProviderCapabilitiesV2 } from "./orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as Orchestrator from "./orchestration-v2/Orchestrator.ts";
import * as ProjectStore from "./orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "./orchestration-v2/ProjectionStore.ts";
import * as SqlitePersistence from "./persistence/Sqlite.ts";
import * as ProcessRunner from "./processRunner.ts";
import * as ProjectService from "./project/ProjectService.ts";
import * as T3ProjectFileLoader from "./project/T3ProjectFileLoader.ts";
import * as WorktreeArchiveScriptRunner from "./project/WorktreeArchiveScriptRunner.ts";
import * as WorktreeRemoval from "./project/WorktreeRemoval.ts";
import * as ServerSettings from "./serverSettings.ts";
import * as StorageCleanup from "./storageCleanup.ts";
import * as TerminalManager from "./terminal/Manager.ts";
import * as GitVcsDriver from "./vcs/GitVcsDriver.ts";

const encodeProviderSession = Schema.encodeEffect(
  Schema.fromJsonString(OrchestrationV2ProviderSessionJson),
);

const NOW = Date.parse("2026-10-06T12:00:00.000Z");
const oldTime = DateTime.makeUnsafe(NOW - 30 * 86_400_000);
const projectId = ProjectId.make("project:storage-cleanup");
const instanceId = ProviderInstanceId.make("codex");
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    NodeFS.rmSync(directory, { recursive: true, force: true });
});

type HookMode = "success" | "failure" | "dirty";
type RootLocation = "default" | "configured" | "previous";

function fixture(mode: HookMode, location: RootLocation) {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-storage-cleanup-"));
  directories.push(directory);
  const root = NodePath.join(directory, "repo");
  const home = NodePath.join(directory, "home");
  const managedRoot =
    location === "default"
      ? NodePath.join(home, "worktrees")
      : NodePath.join(directory, `${location}-worktrees`);
  const worktree = NodePath.join(managedRoot, "feature");
  const marker = NodePath.join(directory, "hook-ran");
  const git = (args: string[], cwd = root) =>
    NodeChildProcess.execFileSync("git", args, { cwd, encoding: "utf8" });
  NodeFS.mkdirSync(root);
  NodeFS.mkdirSync(managedRoot, { recursive: true });
  git(["init", "--initial-branch=main"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Storage cleanup test"]);
  NodeFS.writeFileSync(
    NodePath.join(root, "hook.mjs"),
    `import {writeFileSync} from 'node:fs';
writeFileSync(${JSON.stringify(marker)}, 'ran');
${mode === "dirty" ? "writeFileSync('local.txt', 'keep');" : ""}
${mode === "failure" ? "process.exit(17);" : ""}
`,
  );
  NodeFS.writeFileSync(
    NodePath.join(root, "t3.json"),
    JSON.stringify({
      scripts: [
        {
          id: "remove",
          name: "Remove",
          command: "node hook.mjs",
          runOnWorktreeRemove: true,
        },
      ],
    }),
  );
  git(["add", "hook.mjs", "t3.json"]);
  git(["commit", "--no-verify", "-m", "fixture"]);
  git(["worktree", "add", "-b", "feature", worktree]);
  return { root, home, managedRoot, worktree, marker, git };
}

function thread(worktreePath: string): OrchestrationV2ThreadShell {
  const id = ThreadId.make("thread:storage-cleanup");
  return {
    id,
    projectId,
    title: "Idle checkout",
    providerInstanceId: instanceId,
    modelSelection: { instanceId, model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    worktreePath,
    branch: "feature",
    activeProviderThreadId: null,
    lineage: { rootThreadId: id, parentThreadId: null, relationshipToParent: null },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    activeRunId: null,
    latestVisibleMessage: null,
    hasActionableProposedPlan: false,
    itemCount: 0,
    visibleItemCount: 0,
    lastVisitedAt: null,
    deletedAt: null,
    linkedPullRequest: null,
    status: "idle",
    activityRunStatus: null,
    pendingRuntimeRequest: null,
    pendingBackgroundTasks: [],
    latestRunId: null,
    latestRunRequestedAt: null,
    latestRunStartedAt: null,
    latestRunCompletedAt: null,
    latestUserMessageAt: null,
    createdAt: oldTime,
    updatedAt: oldTime,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
  };
}

function runSweep(input: {
  mode: HookMode;
  location?: RootLocation;
  shared?: boolean;
  liveSession?: boolean;
  archived?: boolean;
}) {
  return Effect.gen(function* () {
    const location = input.location ?? "default";
    const test = fixture(input.mode, location);
    yield* TestClock.setTime(NOW);
    const sweepEntered = yield* Deferred.make<void>();
    const candidate = { ...thread(test.worktree), archivedAt: input.archived ? oldTime : null };
    const threads = input.shared
      ? [candidate, { ...candidate, id: ThreadId.make("thread:shared-checkout") }]
      : [candidate];
    const layerSettings = ServerSettings.layerTest({
      worktreeCleanup: {
        mode: "custom",
        rules: {
          worktreeAfterDays: 7,
          worktreeOnMerge: false,
          worktreeOnDelete: false,
          worktreeUnchanged: false,
        },
      },
      worktreesDirectory: location === "configured" ? test.managedRoot : "",
      previousWorktreesDirectories: location === "previous" ? [test.managedRoot] : [],
    });
    const layerConfig = ServerConfig.layerTest(test.root, test.home).pipe(
      Layer.provide(NodeServices.layer),
    );
    const layerRemoval = WorktreeRemoval.layer.pipe(
      Layer.provide(
        WorktreeArchiveScriptRunner.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              T3ProjectFileLoader.layer,
              ProcessRunner.layer,
              layerSettings,
              Layer.mock(ProjectService.ProjectService)({
                getByWorkspaceRoot: () => Effect.succeed(Option.none()),
              }),
            ),
          ),
        ),
      ),
      Layer.provide(NodeServices.layer),
    );
    const layer = Layer.mergeAll(
      layerConfig,
      layerSettings,
      SqlitePersistence.layerMemory,
      layerRemoval,
      GitVcsDriver.layer.pipe(Layer.provide(layerConfig), Layer.provide(NodeServices.layer)),
      Layer.mock(GitManager.GitManager)({ invalidateStatus: () => Effect.void }),
      Layer.mock(Orchestrator.OrchestratorV2)({ streamDomainEvents: Stream.empty }),
      Layer.mock(TerminalManager.TerminalManager)({
        subscribeMetadata: (listener) =>
          listener({ type: "snapshot", terminals: [] }).pipe(Effect.as(() => {})),
      }),
      Layer.mock(ProjectStore.ProjectStoreV2)({
        listShells: () =>
          Effect.succeed([
            {
              id: projectId,
              title: "Repo",
              workspaceRoot: test.root,
              repositoryIdentity: null,
              defaultModelSelection: null,
              defaultThreadEnvMode: null,
              autoPull: false,
              faviconPath: null,
              projectIcon: null,
              scripts: [],
              createdAt: DateTime.formatIso(oldTime),
              updatedAt: DateTime.formatIso(oldTime),
            },
          ]),
      }),
      Layer.mock(ProjectionStore.ProjectionStoreV2)({
        getShellSnapshot: (options) =>
          Deferred.succeed(sweepEntered, undefined).pipe(
            Effect.as({
              schemaVersion: 2 as const,
              snapshotSequence: 0,
              threads:
                options?.location === "archive" ? [] : threads.filter((t) => t.archivedAt === null),
              archivedThreads:
                options?.location === "archive" ? threads.filter((t) => t.archivedAt !== null) : [],
            }),
          ),
      }),
    ).pipe(Layer.provideMerge(NodeServices.layer));
    yield* Effect.gen(function* () {
      if (input.liveSession) {
        const sql = yield* SqlClient.SqlClient;
        const payload = yield* encodeProviderSession({
          id: ProviderSessionId.make("session:live"),
          driver: ProviderDriverKind.make("codex"),
          providerInstanceId: instanceId,
          status: "ready",
          cwd: test.worktree,
          model: null,
          capabilities: CodexProviderCapabilitiesV2,
          createdAt: oldTime,
          updatedAt: oldTime,
          lastError: null,
        });
        yield* sql`INSERT INTO orchestration_v2_projection_provider_sessions
          (provider_session_id, provider, status, updated_at, payload_json)
          VALUES ('session:live', 'codex', 'ready', ${DateTime.formatIso(oldTime)}, ${payload})`;
      }
      const cleanup = yield* StorageCleanup.make;
      yield* cleanup.start();
      yield* Deferred.await(sweepEntered);
      yield* cleanup.drain;
      const kept = input.mode !== "success" || input.shared || input.liveSession;
      assert.equal(NodeFS.existsSync(test.worktree), Boolean(kept));
      assert.equal(
        test.git(["worktree", "list", "--porcelain"]).includes(test.worktree),
        Boolean(kept),
      );
      assert.equal(NodeFS.existsSync(test.marker), !(input.shared || input.liveSession));
      if (input.mode === "dirty")
        assert.equal(
          NodeFS.readFileSync(NodePath.join(test.worktree, "local.txt"), "utf8"),
          "keep",
        );
    }).pipe(Effect.provide(layer));
  });
}

describe("automatic storage cleanup with real Git and removal hooks", () => {
  it.effect("keeps the checkout when its removal hook process fails", () =>
    runSweep({ mode: "failure" }),
  );
  it.effect("rechecks the checkout after its hook creates local files", () =>
    runSweep({ mode: "dirty" }),
  );
  it.effect("removes a clean checkout after its hook succeeds", () =>
    runSweep({ mode: "success" }),
  );
  it.effect.each(["configured", "previous"] as const)("cleans the %s managed root", (location) =>
    runSweep({ mode: "success", location }),
  );
  it.effect("keeps a checkout shared by two threads without running its hook", () =>
    runSweep({ mode: "success", shared: true }),
  );
  it.effect("keeps a checkout used by a live provider session without running its hook", () =>
    runSweep({ mode: "success", liveSession: true }),
  );
  it.effect("cleans an archived thread checkout", () =>
    runSweep({ mode: "success", archived: true }),
  );
});

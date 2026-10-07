// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type WorktreeSubmodules,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { afterEach } from "vite-plus/test";
import * as ServerConfig from "../config.ts";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { canonicalPath, isManagedWorktree } from "../project/ManagedWorktree.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as EventSink from "./EventSink.ts";
import * as EventStore from "./EventStore.ts";
import * as IdAllocator from "./IdAllocator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as WorktreeRecovery from "./WorktreeRecovery.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    NodeFS.rmSync(directory, { recursive: true, force: true });
});
const projectId = ProjectId.make("project:recovery");
const threadId = ThreadId.make("thread:recovery");
const instanceId = ProviderInstanceId.make("codex");
type Location = "default" | "configured" | "previous" | "foreign" | "escape";
function fixture(location: Location, submodule = false) {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-recovery-"));
  directories.push(directory);
  const root = NodePath.join(directory, "repo");
  const home = NodePath.join(directory, "home");
  const managedRoot =
    location === "default" || location === "escape"
      ? NodePath.join(home, "worktrees")
      : NodePath.join(directory, `${location}-worktrees`);
  const worktree = NodePath.join(managedRoot, "feature");
  const git = (args: string[], cwd = root) =>
    NodeChildProcess.execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GIT_ALLOW_PROTOCOL: "file" },
    });
  const init = (cwd: string) => {
    NodeFS.mkdirSync(cwd, { recursive: true });
    git(["init", "--initial-branch=main"], cwd);
    git(["config", "user.email", "test@example.com"], cwd);
    git(["config", "user.name", "Recovery test"], cwd);
    NodeFS.writeFileSync(NodePath.join(cwd, "kept.txt"), "committed\n");
    git(["add", "."], cwd);
    git(["commit", "--no-verify", "-m", "fixture"], cwd);
  };
  init(root);
  NodeFS.mkdirSync(managedRoot, { recursive: true });
  if (submodule) {
    const shared = NodePath.join(directory, "shared");
    init(shared);
    git(["submodule", "add", shared, "shared"]);
    git(["commit", "--no-verify", "-m", "submodule"]);
  }
  git(["branch", "feature"]);
  const commit = git(["rev-parse", "feature"]).trim();
  if (location === "escape") {
    NodeFS.symlinkSync(directory, NodePath.join(managedRoot, "link"));
    return {
      root,
      home,
      managedRoot,
      worktree: NodePath.join(managedRoot, "link", "missing", "feature"),
      git,
      commit,
    };
  }
  git(["worktree", "add", worktree, "feature"]);
  NodeFS.rmSync(worktree, { recursive: true });
  return { root, home, managedRoot, worktree, git, commit };
}

function recover(input: {
  location: Location;
  submodules?: WorktreeSubmodules;
  changeBeforeCreate?: "delete" | "branch" | "path";
  failedBranch?: boolean;
}) {
  return Effect.gen(function* () {
    const test = fixture(input.location, input.submodules !== undefined);
    const config = ServerConfig.layerTest(test.root, test.home).pipe(
      Layer.provide(NodeServices.layer),
    );
    const settings = ServerSettings.layerTest({
      worktreesDirectory: input.location === "configured" ? test.managedRoot : "",
      previousWorktreesDirectories: input.location === "previous" ? [test.managedRoot] : [],
      projectSettingsOverrides:
        input.submodules === undefined
          ? {}
          : { [projectId]: { worktreeSubmodules: input.submodules } },
    });
    const stores = Layer.merge(EventStore.layer, ProjectionStore.layer).pipe(
      Layer.provide(SqlitePersistence.layerMemory),
    );
    const sink = EventSink.layer.pipe(
      Layer.provide(Layer.merge(stores, SqlitePersistence.layerMemory)),
    );
    const gitLayer = GitVcsDriver.layer.pipe(
      Layer.provide(config),
      Layer.provide(NodeServices.layer),
    );
    const workflow = Layer.unwrap(
      Effect.gen(function* () {
        const driver = yield* GitVcsDriver.GitVcsDriver;
        const eventSink = yield* EventSink.EventSinkV2;
        const ids = yield* IdAllocator.IdAllocatorV2;
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        return Layer.mock(GitWorkflow.GitWorkflowService)({
          pruneWorktrees: (request) =>
            driver.pruneWorktrees(request).pipe(
              Effect.andThen(
                Effect.gen(function* () {
                  if (input.changeBeforeCreate === undefined) return;
                  const current = yield* projections.getThread(threadId);
                  const now = yield* DateTime.now;
                  yield* eventSink.write({
                    events: [
                      {
                        id: yield* ids.allocate.event({ threadId }),
                        type:
                          input.changeBeforeCreate === "delete"
                            ? "thread.deleted"
                            : "thread.metadata-updated",
                        threadId,
                        occurredAt: now,
                        payload: {
                          ...current,
                          ...(input.changeBeforeCreate === "delete"
                            ? { deletedAt: now }
                            : input.changeBeforeCreate === "branch"
                              ? { branch: "main" }
                              : { worktreePath: NodePath.join(test.managedRoot, "changed") }),
                          updatedAt: now,
                        },
                      },
                    ],
                  });
                }).pipe(Effect.orDie),
              ),
            ),
          createWorktree: (request, options) => driver.createWorktree(request, options),
        });
      }),
    ).pipe(Layer.provide(Layer.mergeAll(gitLayer, sink, stores, IdAllocator.layer)));
    const layer = Layer.mergeAll(
      config,
      settings,
      stores,
      sink,
      IdAllocator.layer,
      workflow,
      Layer.mock(ProjectService.ProjectService)({
        getById: () => Effect.succeed(Option.some({ workspaceRoot: test.root } as never)),
      }),
    ).pipe(Layer.provideMerge(NodeServices.layer));
    yield* Effect.gen(function* () {
      const eventSink = yield* EventSink.EventSinkV2;
      const ids = yield* IdAllocator.IdAllocatorV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const now = yield* DateTime.now;
      yield* eventSink.write({
        events: [
          {
            id: yield* ids.allocate.event({ threadId }),
            type: "thread.created",
            threadId,
            occurredAt: now,
            payload: {
              id: threadId,
              projectId,
              title: "Recovery",
              providerInstanceId: instanceId,
              modelSelection: { instanceId, model: "gpt-5.4" },
              runtimeMode: "full-access",
              interactionMode: "default",
              branch: input.failedBranch ? "missing-branch" : "feature",
              worktreePath: test.worktree,
              activeProviderThreadId: null,
              lineage: { rootThreadId: threadId, parentThreadId: null, relationshipToParent: null },
              forkedFrom: null,
              createdBy: "user",
              creationSource: "web",
              createdAt: now,
              updatedAt: now,
              archivedAt: null,
              settledOverride: null,
              settledAt: null,
              lastVisitedAt: null,
              deletedAt: null,
            },
          },
        ],
      });
      const restore = yield* WorktreeRecovery.make;
      yield* restore(threadId, test.worktree);
      const saved = yield* projections.getThread(threadId);
      if (input.changeBeforeCreate === "delete") assert.isNotNull(saved.deletedAt);
      if (input.changeBeforeCreate === "branch") assert.equal(saved.branch, "main");
      if (input.changeBeforeCreate === "path")
        assert.equal(saved.worktreePath, NodePath.join(test.managedRoot, "changed"));
      const expected =
        input.location !== "foreign" &&
        input.location !== "escape" &&
        input.changeBeforeCreate === undefined &&
        !input.failedBranch;
      assert.equal(NodeFS.existsSync(test.worktree), expected);
      let notices = (yield* projections.getThreadProjection(threadId)).turnItems.filter(
        (item) => item.type === "system_notice",
      );
      assert.lengthOf(notices, expected ? 1 : 0);
      if (expected) {
        assert.equal(test.git(["branch", "--show-current"], test.worktree).trim(), "feature");
        assert.equal(test.git(["rev-parse", "HEAD"], test.worktree).trim(), test.commit);
        assert.equal(
          NodeFS.readFileSync(NodePath.join(test.worktree, "kept.txt"), "utf8"),
          "committed\n",
        );
        assert.include(notices[0]!.message ?? "", "excludes uncommitted work");
        if (input.submodules !== undefined)
          assert.equal(
            NodeFS.existsSync(NodePath.join(test.worktree, "shared", "kept.txt")),
            input.submodules !== "none",
          );
        yield* restore(threadId, test.worktree);
        notices = (yield* projections.getThreadProjection(threadId)).turnItems.filter(
          (item) => item.type === "system_notice",
        );
        assert.lengthOf(notices, 1);
      }
    }).pipe(Effect.provide(layer));
  });
}

describe("saved worktree recovery with real Git and persisted notices", () => {
  it.effect.each(["default", "configured", "previous", "foreign", "escape"] as const)(
    "handles the %s location",
    (location) => recover({ location }),
  );
  it.effect.each(["delete", "branch", "path"] as const)(
    "rechecks a %s change during pruning",
    (changeBeforeCreate) => recover({ location: "default", changeBeforeCreate }),
  );
  it.effect("leaves an unavailable saved branch missing without a notice", () =>
    recover({ location: "default", failedBranch: true }),
  );
  it.effect.each(["none", "recursive"] as const)(
    "keeps the project submodule policy %s",
    (submodules) =>
      Effect.gen(function* () {
        const previous = process.env.GIT_ALLOW_PROTOCOL;
        process.env.GIT_ALLOW_PROTOCOL = "file";
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            if (previous === undefined) delete process.env.GIT_ALLOW_PROTOCOL;
            else process.env.GIT_ALLOW_PROTOCOL = previous;
          }),
        );
        yield* recover({ location: "configured", submodules });
      }),
  );
  it("rejects filesystem roots, sibling prefixes, dangling links, and nested symlink escapes", () => {
    const test = fixture("default");
    assert.isFalse(isManagedWorktree(NodePath.parse(test.home).root, test.worktree));
    assert.isFalse(isManagedWorktree(test.managedRoot, `${test.managedRoot}-other/feature`));
    assert.isFalse(isManagedWorktree(test.managedRoot, test.managedRoot));
    NodeFS.symlinkSync(test.root, NodePath.join(test.managedRoot, "outside"));
    assert.isFalse(
      isManagedWorktree(
        test.managedRoot,
        NodePath.join(test.managedRoot, "outside", "missing", "feature"),
      ),
    );
    NodeFS.symlinkSync(
      NodePath.join(test.root, "missing"),
      NodePath.join(test.managedRoot, "dangling"),
    );
    assert.isFalse(
      isManagedWorktree(test.managedRoot, NodePath.join(test.managedRoot, "dangling", "feature")),
    );
    assert.isNull(canonicalPath(NodePath.join(test.managedRoot, "dangling", "feature")));
    NodeFS.symlinkSync(test.managedRoot, NodePath.join(test.root, "managed-link"));
    assert.isTrue(isManagedWorktree(NodePath.join(test.root, "managed-link"), test.worktree));
    assert.isTrue(
      isManagedWorktree(
        test.managedRoot,
        NodePath.join(test.managedRoot, "missing", "nested", "feature"),
      ),
    );
  });
});

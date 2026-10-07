// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { afterEach } from "vite-plus/test";

import * as ProcessRunner from "../processRunner.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ProjectService from "./ProjectService.ts";
import * as T3ProjectFileLoader from "./T3ProjectFileLoader.ts";
import * as WorktreeArchiveScriptRunner from "./WorktreeArchiveScriptRunner.ts";
import * as WorktreeRemoval from "./WorktreeRemoval.ts";

const layerRemoval = WorktreeRemoval.layer.pipe(
  Layer.provide(
    WorktreeArchiveScriptRunner.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          T3ProjectFileLoader.layer,
          ProcessRunner.layer,
          ServerSettings.layerTest(),
          Layer.mock(ProjectService.ProjectService)({
            getByWorkspaceRoot: () => Effect.succeed(Option.none()),
          }),
        ),
      ),
    ),
  ),
  Layer.provide(NodeServices.layer),
);

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    NodeFS.rmSync(directory, { recursive: true, force: true });
});

function fixture(mode: "success" | "failure" | "dirty") {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-removal-integration-"));
  directories.push(directory);
  const root = NodePath.join(directory, "repo");
  const worktree = NodePath.join(directory, "worktree");
  const marker = NodePath.join(directory, "hook-ran");
  const git = (args: string[], cwd = root) =>
    NodeChildProcess.execFileSync("git", args, { cwd, encoding: "utf8" });
  NodeFS.mkdirSync(root);
  git(["init", "--initial-branch=main"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Removal test"]);
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
        { id: "remove", name: "Remove", command: "node hook.mjs", runOnWorktreeRemove: true },
      ],
    }),
  );
  git(["add", "hook.mjs", "t3.json"]);
  git(["commit", "--no-verify", "-m", "fixture"]);
  git(["worktree", "add", "-b", "feature", worktree]);
  return { root, worktree, marker, git };
}

describe("worktree removal with real Git and script processes", () => {
  it.effect("runs the checkout hook before removing the checkout", () =>
    Effect.gen(function* () {
      const test = fixture("success");
      const removal = yield* WorktreeRemoval.WorktreeRemoval;
      yield* removal.remove(
        { cwd: test.root, path: test.worktree, force: false },
        Effect.succeed(
          Effect.sync(() => {
            assert.equal(NodeFS.readFileSync(test.marker, "utf8"), "ran");
            test.git(["worktree", "remove", test.worktree]);
          }),
        ),
      );
      assert.isFalse(NodeFS.existsSync(test.worktree));
      assert.notInclude(test.git(["worktree", "list", "--porcelain"]), test.worktree);
    }).pipe(Effect.provide(layerRemoval)),
  );

  it.effect("keeps the checkout when the hook process fails", () =>
    Effect.gen(function* () {
      const test = fixture("failure");
      const removal = yield* WorktreeRemoval.WorktreeRemoval;
      const result = yield* removal
        .remove(
          { cwd: test.root, path: test.worktree, force: false },
          Effect.succeed(
            Effect.sync(() => {
              test.git(["worktree", "remove", test.worktree]);
            }),
          ),
        )
        .pipe(Effect.result);
      assert.isTrue(result._tag === "Failure");
      assert.equal(NodeFS.readFileSync(test.marker, "utf8"), "ran");
      assert.isTrue(NodeFS.existsSync(test.worktree));
      assert.include(test.git(["worktree", "list", "--porcelain"]), test.worktree);
    }).pipe(Effect.provide(layerRemoval)),
  );

  it.effect("honors the explicit skip option", () =>
    Effect.gen(function* () {
      const test = fixture("failure");
      const removal = yield* WorktreeRemoval.WorktreeRemoval;
      yield* removal.remove(
        { cwd: test.root, path: test.worktree, force: false, skipArchiveScript: true },
        Effect.succeed(
          Effect.sync(() => {
            test.git(["worktree", "remove", test.worktree]);
          }),
        ),
      );
      assert.isFalse(NodeFS.existsSync(test.marker));
      assert.isFalse(NodeFS.existsSync(test.worktree));
    }).pipe(Effect.provide(layerRemoval)),
  );

  it.effect("allows a final safety check to retain files created by the hook", () =>
    Effect.gen(function* () {
      const test = fixture("dirty");
      const removal = yield* WorktreeRemoval.WorktreeRemoval;
      yield* removal.remove(
        { cwd: test.root, path: test.worktree, force: false },
        Effect.succeed(
          Effect.sync(() => {
            if (test.git(["status", "--porcelain"], test.worktree) === "")
              test.git(["worktree", "remove", test.worktree]);
          }),
        ),
      );
      assert.equal(NodeFS.readFileSync(NodePath.join(test.worktree, "local.txt"), "utf8"), "keep");
      assert.isTrue(NodeFS.existsSync(test.marker));
    }).pipe(Effect.provide(layerRemoval)),
  );

  it.effect("does not run a hook when preparation rejects removal", () =>
    Effect.gen(function* () {
      const test = fixture("success");
      const removal = yield* WorktreeRemoval.WorktreeRemoval;
      yield* removal.remove(
        { cwd: test.root, path: test.worktree, force: false },
        Effect.succeed(undefined),
      );
      assert.isFalse(NodeFS.existsSync(test.marker));
      assert.isTrue(NodeFS.existsSync(test.worktree));
    }).pipe(Effect.provide(layerRemoval)),
  );
});

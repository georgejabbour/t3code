import { describe, expect, it, vi } from "@effect/vitest";
import type { T3ProjectFile } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProcessRunner from "../processRunner.ts";
import * as T3ProjectFileLoader from "./T3ProjectFileLoader.ts";
import * as WorktreeArchiveScriptRunner from "./WorktreeArchiveScriptRunner.ts";

const WORKSPACE_ROOT = "/repo/project";
const WORKTREE_PATH = "/repo/worktrees/a";

const makeProjectFileLoaderLayer = (projectFile: T3ProjectFile | null) =>
  Layer.succeed(T3ProjectFileLoader.T3ProjectFileLoader, {
    load: (workspaceRoot) =>
      Effect.succeed(
        projectFile !== null && workspaceRoot === WORKSPACE_ROOT
          ? Option.some(projectFile)
          : Option.none(),
      ),
  });

const makeProcessRunnerLayer = (run: ProcessRunner.ProcessRunner["Service"]["run"]) =>
  Layer.succeed(ProcessRunner.ProcessRunner, { run });

const testLayer = (
  projectFile: T3ProjectFile | null,
  run: ProcessRunner.ProcessRunner["Service"]["run"],
) =>
  WorktreeArchiveScriptRunner.layer.pipe(
    Layer.provideMerge(makeProjectFileLoaderLayer(projectFile)),
    Layer.provideMerge(makeProcessRunnerLayer(run)),
  );

const processOutput = (
  overrides: Partial<ProcessRunner.ProcessRunOutput> = {},
): ProcessRunner.ProcessRunOutput => ({
  stdout: "",
  stderr: "",
  code: 0 as ProcessRunner.ProcessRunOutput["code"],
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
  ...overrides,
});

const archiveScript = {
  name: "Archive workspace",
  command: "bash .agents/workspaces/archive.sh",
  runOnWorktreeRemove: true,
};

describe("WorktreeArchiveScriptRunner", () => {
  it.effect("returns no-script when the repository has no t3.json", () => {
    const run = vi.fn(() => Effect.die("unexpected run"));

    return Effect.gen(function* () {
      const runner = yield* WorktreeArchiveScriptRunner.WorktreeArchiveScriptRunner;
      const result = yield* runner.run({
        workspaceRoot: WORKSPACE_ROOT,
        worktreePath: WORKTREE_PATH,
      });

      expect(result).toEqual({ status: "no-script" });
      expect(run).not.toHaveBeenCalled();
    }).pipe(Effect.provide(testLayer(null, run as never)));
  });

  it.effect("returns no-script when no script opts into runOnWorktreeRemove", () => {
    const run = vi.fn(() => Effect.die("unexpected run"));
    const projectFile: T3ProjectFile = {
      scripts: [{ name: "Setup", command: "./setup.sh", runOnWorktreeCreate: true }],
    };

    return Effect.gen(function* () {
      const runner = yield* WorktreeArchiveScriptRunner.WorktreeArchiveScriptRunner;
      const result = yield* runner.run({
        workspaceRoot: WORKSPACE_ROOT,
        worktreePath: WORKTREE_PATH,
      });

      expect(result).toEqual({ status: "no-script" });
      expect(run).not.toHaveBeenCalled();
    }).pipe(Effect.provide(testLayer(projectFile, run as never)));
  });

  it.effect("runs the flagged script in the worktree with the project env", () => {
    let captured: ProcessRunner.ProcessRunInput | undefined;
    const run = vi.fn((input: ProcessRunner.ProcessRunInput) => {
      captured = input;
      return Effect.succeed(processOutput());
    });
    const projectFile: T3ProjectFile = { scripts: [archiveScript] };

    return Effect.gen(function* () {
      const runner = yield* WorktreeArchiveScriptRunner.WorktreeArchiveScriptRunner;
      const result = yield* runner.run({
        workspaceRoot: WORKSPACE_ROOT,
        worktreePath: WORKTREE_PATH,
      });

      expect(result).toEqual({ status: "ok", scriptName: "Archive workspace" });
      expect(run).toHaveBeenCalledTimes(1);
      // The worktree still exists here, and the script resolves its own paths from it.
      expect(captured?.cwd).toBe(WORKTREE_PATH);
      expect(captured?.args.at(-1)).toBe(archiveScript.command);
      expect(captured?.env).toMatchObject({
        T3CODE_PROJECT_ROOT: WORKSPACE_ROOT,
        T3CODE_WORKTREE_PATH: WORKTREE_PATH,
      });
      // Teardown outlives ProcessRunner's 60s default, so the runner must override it.
      expect(captured?.timeout).toBe("10 minutes");
    }).pipe(Effect.provide(testLayer(projectFile, run as never)));
  });

  it.effect("fails with the script output when the script exits non-zero", () => {
    const run = vi.fn(() =>
      Effect.succeed(
        processOutput({
          code: 3 as ProcessRunner.ProcessRunOutput["code"],
          stderr: "compose down failed",
        }),
      ),
    );
    const projectFile: T3ProjectFile = { scripts: [archiveScript] };

    return Effect.gen(function* () {
      const runner = yield* WorktreeArchiveScriptRunner.WorktreeArchiveScriptRunner;
      const error = yield* Effect.flip(
        runner.run({ workspaceRoot: WORKSPACE_ROOT, worktreePath: WORKTREE_PATH }),
      );

      expect(error._tag).toBe("WorktreeArchiveScriptError");
      expect(error.exitCode).toBe(3);
      expect(error.timedOut).toBe(false);
      expect(error.stderr).toBe("compose down failed");
      expect(error.worktreePath).toBe(WORKTREE_PATH);
    }).pipe(Effect.provide(testLayer(projectFile, run as never)));
  });

  it.effect("fails and reports timedOut when the script exceeds its timeout", () => {
    const run = vi.fn(() =>
      Effect.succeed(processOutput({ code: null, timedOut: true, stdout: "stopping infra" })),
    );
    const projectFile: T3ProjectFile = { scripts: [archiveScript] };

    return Effect.gen(function* () {
      const runner = yield* WorktreeArchiveScriptRunner.WorktreeArchiveScriptRunner;
      const error = yield* Effect.flip(
        runner.run({ workspaceRoot: WORKSPACE_ROOT, worktreePath: WORKTREE_PATH }),
      );

      expect(error._tag).toBe("WorktreeArchiveScriptError");
      expect(error.timedOut).toBe(true);
      expect(error.exitCode).toBeUndefined();
      expect(error.stdout).toBe("stopping infra");
    }).pipe(Effect.provide(testLayer(projectFile, run as never)));
  });
});

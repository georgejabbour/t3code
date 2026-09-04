import { describe, expect, it, vi } from "@effect/vitest";
import { type OrchestrationProject, type ProjectScript, ProjectId } from "@t3tools/contracts";
import type { T3ProjectFile } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as T3ProjectFileLoader from "./T3ProjectFileLoader.ts";
import * as WorktreeArchiveScriptRunner from "./WorktreeArchiveScriptRunner.ts";

const WORKSPACE_ROOT = "/repo/project";
const WORKTREE_PATH = "/repo/worktrees/a";

/** Serves a different t3.json per path so precedence is observable. */
const makeProjectFileLoaderLayer = (files: {
  readonly root?: T3ProjectFile | null;
  readonly worktree?: T3ProjectFile | null;
}) =>
  Layer.succeed(T3ProjectFileLoader.T3ProjectFileLoader, {
    load: (path) => {
      const found =
        path === WORKTREE_PATH ? files.worktree : path === WORKSPACE_ROOT ? files.root : null;
      return Effect.succeed(found ? Option.some(found) : Option.none());
    },
  });

const makeProcessRunnerLayer = (run: ProcessRunner.ProcessRunner["Service"]["run"]) =>
  Layer.succeed(ProcessRunner.ProcessRunner, { run });

/** The project's imported scripts — what the scripts dialog's toggle writes. */
const makeProjectionSnapshotQueryLayer = (scripts: readonly ProjectScript[]) => {
  const project = {
    id: ProjectId.make("project-1"),
    title: "Project",
    workspaceRoot: WORKSPACE_ROOT,
    defaultModelSelection: null,
    scripts,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
  } satisfies OrchestrationProject;
  return Layer.succeed(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
    getCommandReadModel: () => Effect.die("unused"),
    getEventReplayStats: () => Effect.die("unused"),
    getSnapshot: () => Effect.die("unused"),
    getShellSnapshot: () => Effect.die("unused"),
    getArchivedShellSnapshot: () => Effect.die("unused"),
    getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 1 }),
    getCounts: () => Effect.die("unused"),
    getActiveProjectByWorkspaceRoot: (workspaceRoot) =>
      Effect.succeed(workspaceRoot === WORKSPACE_ROOT ? Option.some(project) : Option.none()),
    getProjectShellById: () => Effect.succeed(Option.none()),
    getFirstActiveThreadIdByProjectId: () => Effect.die("unused"),
    getThreadCheckpointContext: () => Effect.die("unused"),
    getFullThreadDiffContext: () => Effect.die("unused"),
    getThreadShellById: () => Effect.die("unused"),
    getThreadDetailById: () => Effect.die("unused"),
    getThreadDetailSnapshot: () => Effect.die("unused"),
    searchThreads: () => Effect.succeed({ matches: [] }),
    getUserInputActivity: () => Effect.die("unused"),
  });
};

/** Every field of a folder's stat record, so the runner reads a real directory rather than a partial stand-in. */
const DIRECTORY_INFO: FileSystem.File.Info = {
  type: "Directory",
  mtime: Option.none(),
  atime: Option.none(),
  birthtime: Option.none(),
  dev: 0,
  ino: Option.none(),
  mode: 0o755,
  nlink: Option.none(),
  uid: Option.none(),
  gid: Option.none(),
  rdev: Option.none(),
  size: FileSystem.Size(0),
  blksize: Option.none(),
  blocks: Option.none(),
};

/** The worktree is still on disk — the state every case but one assumes. */
const PresentWorktreeFileSystem = FileSystem.layerNoop({
  stat: () => Effect.succeed(DIRECTORY_INFO),
});

/** The worktree folder is gone. `layerNoop` fails `stat` with NotFound, which is what the disk reports. */
const MissingWorktreeFileSystem = FileSystem.layerNoop({});

const testLayer = (
  files: {
    readonly root?: T3ProjectFile | null;
    readonly worktree?: T3ProjectFile | null;
  },
  run: ProcessRunner.ProcessRunner["Service"]["run"],
  importedScripts: readonly ProjectScript[] = [],
  fileSystem: Layer.Layer<FileSystem.FileSystem> = PresentWorktreeFileSystem,
) =>
  WorktreeArchiveScriptRunner.layer.pipe(
    Layer.provideMerge(makeProjectFileLoaderLayer(files)),
    Layer.provideMerge(makeProcessRunnerLayer(run)),
    Layer.provideMerge(makeProjectionSnapshotQueryLayer(importedScripts)),
    Layer.provideMerge(fileSystem),
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
  stdoutInvalidUtf8: false,
  stderrInvalidUtf8: false,
  ...overrides,
});

const IMPORTED_SCRIPTS: readonly ProjectScript[] = [
  {
    id: "setup",
    name: "Setup",
    command: "./setup.sh",
    icon: "configure",
    runOnWorktreeCreate: true,
  },
  {
    id: "archive",
    name: "Imported archive",
    command: "./imported.sh",
    icon: "debug",
    runOnWorktreeCreate: false,
    runOnWorktreeRemove: true,
  },
];

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
    }).pipe(Effect.provide(testLayer({}, run as never)));
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
    }).pipe(Effect.provide(testLayer({ worktree: projectFile }, run as never)));
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
    }).pipe(Effect.provide(testLayer({ worktree: projectFile }, run as never)));
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
    }).pipe(Effect.provide(testLayer({ worktree: projectFile }, run as never)));
  });

  it.effect("prefers the worktree's t3.json over the project root's", () => {
    let captured: ProcessRunner.ProcessRunInput | undefined;
    const run = vi.fn((input: ProcessRunner.ProcessRunInput) => {
      captured = input;
      return Effect.succeed(processOutput());
    });

    return Effect.gen(function* () {
      const runner = yield* WorktreeArchiveScriptRunner.WorktreeArchiveScriptRunner;
      const result = yield* runner.run({
        workspaceRoot: WORKSPACE_ROOT,
        worktreePath: WORKTREE_PATH,
      });

      expect(result).toEqual({ status: "ok", scriptName: "From the worktree" });
      expect(captured?.args.at(-1)).toBe("./worktree.sh");
    }).pipe(
      Effect.provide(
        testLayer(
          {
            root: {
              scripts: [{ name: "From the root", command: "./root.sh", runOnWorktreeRemove: true }],
            },
            worktree: {
              scripts: [
                { name: "From the worktree", command: "./worktree.sh", runOnWorktreeRemove: true },
              ],
            },
          },
          run as never,
        ),
      ),
    );
  });

  it.effect("falls back to the project root when the worktree has no t3.json", () => {
    let captured: ProcessRunner.ProcessRunInput | undefined;
    const run = vi.fn((input: ProcessRunner.ProcessRunInput) => {
      captured = input;
      return Effect.succeed(processOutput());
    });

    return Effect.gen(function* () {
      const runner = yield* WorktreeArchiveScriptRunner.WorktreeArchiveScriptRunner;
      const result = yield* runner.run({
        workspaceRoot: WORKSPACE_ROOT,
        worktreePath: WORKTREE_PATH,
      });

      expect(result).toEqual({ status: "ok", scriptName: "From the root" });
      expect(captured?.args.at(-1)).toBe("./root.sh");
    }).pipe(
      Effect.provide(
        testLayer(
          {
            root: {
              scripts: [{ name: "From the root", command: "./root.sh", runOnWorktreeRemove: true }],
            },
            worktree: null,
          },
          run as never,
        ),
      ),
    );
  });

  it.effect("falls back to an imported script flagged by the dialog toggle", () => {
    let captured: ProcessRunner.ProcessRunInput | undefined;
    const run = vi.fn((input: ProcessRunner.ProcessRunInput) => {
      captured = input;
      return Effect.succeed(processOutput());
    });

    return Effect.gen(function* () {
      const runner = yield* WorktreeArchiveScriptRunner.WorktreeArchiveScriptRunner;
      const result = yield* runner.run({
        workspaceRoot: WORKSPACE_ROOT,
        worktreePath: WORKTREE_PATH,
      });

      expect(result).toEqual({ status: "ok", scriptName: "Imported archive" });
      expect(captured?.args.at(-1)).toBe("./imported.sh");
    }).pipe(Effect.provide(testLayer({}, run as never, IMPORTED_SCRIPTS)));
  });

  it.effect("prefers a checked-in t3.json script over an imported one", () => {
    let captured: ProcessRunner.ProcessRunInput | undefined;
    const run = vi.fn((input: ProcessRunner.ProcessRunInput) => {
      captured = input;
      return Effect.succeed(processOutput());
    });

    return Effect.gen(function* () {
      const runner = yield* WorktreeArchiveScriptRunner.WorktreeArchiveScriptRunner;
      const result = yield* runner.run({
        workspaceRoot: WORKSPACE_ROOT,
        worktreePath: WORKTREE_PATH,
      });

      expect(result).toEqual({ status: "ok", scriptName: "Archive workspace" });
      expect(captured?.args.at(-1)).toBe(archiveScript.command);
    }).pipe(Effect.provide(testLayer({ worktree: { scripts: [archiveScript] } }, run as never)));
  });

  it.effect("returns no-worktree and never spawns when the worktree folder is gone", () => {
    const run = vi.fn(() => Effect.die("unexpected run"));
    const projectFile: T3ProjectFile = { scripts: [archiveScript] };

    return Effect.gen(function* () {
      const runner = yield* WorktreeArchiveScriptRunner.WorktreeArchiveScriptRunner;
      const result = yield* runner.run({
        workspaceRoot: WORKSPACE_ROOT,
        worktreePath: WORKTREE_PATH,
      });

      // A shell started in a folder that is not there fails with
      // `spawn /bin/sh ENOENT`, which names the shell and hides the real reason.
      expect(result).toEqual({ status: "no-worktree" });
      expect(run).not.toHaveBeenCalled();
    }).pipe(
      Effect.provide(
        testLayer({ worktree: projectFile }, run as never, [], MissingWorktreeFileSystem),
      ),
    );
  });

  it.effect("keeps the reason the operating system gave when the spawn fails", () => {
    const run = vi.fn(() =>
      Effect.fail(
        new ProcessRunner.ProcessSpawnError({
          command: "/bin/sh",
          argumentCount: 2,
          cwd: WORKTREE_PATH,
          cause: new Error("spawn /bin/sh ENOENT"),
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
      expect(error.stderr).toContain("Failed to spawn process");
      // Without the cause the report names /bin/sh and never says what went wrong.
      expect(error.stderr).toContain("spawn /bin/sh ENOENT");
    }).pipe(Effect.provide(testLayer({ worktree: projectFile }, run as never)));
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
    }).pipe(Effect.provide(testLayer({ worktree: projectFile }, run as never)));
  });
});

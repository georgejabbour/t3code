/** Runs the selected archive script before worktree removal. */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { WorktreeArchiveScriptError } from "@t3tools/contracts";
import { isHostWindows } from "@t3tools/shared/hostProcess";
import {
  projectScriptRuntimeEnv,
  resolveProjectScripts,
  worktreeRemoveScript,
} from "@t3tools/shared/projectScripts";

import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as T3ProjectFileLoader from "./T3ProjectFileLoader.ts";

/**
 * Teardown routinely stops containers, removes volumes and prunes images, which
 * is far slower than ProcessRunner's 60 second default.
 */
const ARCHIVE_SCRIPT_TIMEOUT = "10 minutes";

/** Enough output to diagnose a failure in the dialog without holding a whole build log. */
const MAX_OUTPUT_BYTES = 256 * 1024;

export interface WorktreeArchiveScriptRunnerInput {
  readonly workspaceRoot: string;
  readonly worktreePath: string;
}

export type WorktreeArchiveScriptRunnerResult =
  | { readonly status: "no-script" }
  | { readonly status: "no-worktree" }
  | { readonly status: "ok"; readonly scriptName: string };

/**
 * The failure text the caller shows, with the reason the operating system gave.
 *
 * A ProcessRunner failure names the command and the folder and stops there. The
 * detail that explains it — `spawn /bin/sh ENOENT`, a permission refusal — sits
 * one level down in `cause`, so both go in. Two of the five failures carry no
 * cause, and those report their own text alone.
 */
const describeProcessFailure = (error: ProcessRunner.ProcessRunError): string =>
  "cause" in error ? `${error}\n${String(error.cause)}` : `${error}`;

export class WorktreeArchiveScriptRunner extends Context.Service<
  WorktreeArchiveScriptRunner,
  {
    readonly run: (
      input: WorktreeArchiveScriptRunnerInput,
    ) => Effect.Effect<WorktreeArchiveScriptRunnerResult, WorktreeArchiveScriptError>;
  }
>()("t3/project/WorktreeArchiveScriptRunner") {}

export const make = Effect.gen(function* () {
  const projectFileLoader = yield* T3ProjectFileLoader.T3ProjectFileLoader;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const fileSystem = yield* FileSystem.FileSystem;
  const serverSettings = yield* ServerSettings.ServerSettingsService;

  const run: WorktreeArchiveScriptRunner["Service"]["run"] = Effect.fn(
    "WorktreeArchiveScriptRunner.run",
  )(function* (input) {
    // A thread keeps its worktree path after the folder goes away — removed by
    // hand, or removed on an earlier pass — so most archived threads on an old
    // install point at nothing. There is no folder to read a t3.json from and
    // no services left to stop, and starting a shell in a folder that is not
    // there fails with `spawn /bin/sh ENOENT`, which names the shell and hides
    // the real reason.
    const worktreePresent = yield* fileSystem.stat(input.worktreePath).pipe(
      Effect.map((info) => info.type === "Directory"),
      Effect.orElseSucceed(() => false),
    );
    if (!worktreePresent) {
      yield* Effect.logDebug("project.worktree-archive-script.worktree-missing", {
        worktreePath: input.worktreePath,
      });
      return { status: "no-worktree" } as const;
    }

    // Resolution order, most specific first:
    //   1. the WORKTREE's t3.json — it is the checkout being torn down, and the
    //      script that runs is its file too (relative command, cwd = worktree),
    //      so config and script stay on one branch;
    //   2. the project root's t3.json — a branch made before the file existed;
    //   3. the resolved project actions, including settings overrides and defaults.
    const worktreeFile = yield* projectFileLoader.load(input.worktreePath);
    const rootFile = Option.isSome(worktreeFile)
      ? worktreeFile
      : yield* projectFileLoader.load(input.workspaceRoot);
    const fileScript = Option.isSome(rootFile)
      ? worktreeRemoveScript(rootFile.value.scripts ?? [])
      : null;

    const script =
      fileScript ??
      (yield* Effect.gen(function* () {
        const project = yield* projectionSnapshotQuery
          .getActiveProjectByWorkspaceRoot(input.workspaceRoot)
          .pipe(Effect.orElseSucceed(() => Option.none()));
        if (Option.isSome(project)) {
          const settings = yield* serverSettings.getSettings.pipe(
            Effect.mapError(
              (cause) =>
                new WorktreeArchiveScriptError({
                  scriptName: "Archive script",
                  command: "",
                  worktreePath: input.worktreePath,
                  timedOut: false,
                  stdout: "",
                  stderr: `Cannot read project actions: ${cause}`,
                }),
            ),
          );
          return worktreeRemoveScript(resolveProjectScripts(settings, project.value));
        }
        return null;
      }));
    if (!script) {
      return { status: "no-script" } as const;
    }

    const windows = yield* isHostWindows;
    // `/d /s /c` keeps cmd.exe from running AutoRun commands or re-quoting the
    // payload; `sh -c` is the POSIX equivalent.
    const command = windows ? "cmd.exe" : "/bin/sh";
    const args = windows ? ["/d", "/s", "/c", script.command] : ["-c", script.command];

    const failure = (fields: {
      readonly exitCode?: number | undefined;
      readonly timedOut: boolean;
      readonly stdout: string;
      readonly stderr: string;
    }) =>
      new WorktreeArchiveScriptError({
        scriptName: script.name,
        command: script.command,
        worktreePath: input.worktreePath,
        timedOut: fields.timedOut,
        stdout: fields.stdout,
        stderr: fields.stderr,
        ...(fields.exitCode === undefined ? {} : { exitCode: fields.exitCode }),
      });

    const result = yield* processRunner
      .run({
        command,
        args,
        // The check above proved the folder is there, so the script can reach
        // its own compose file and env.
        cwd: input.worktreePath,
        env: projectScriptRuntimeEnv({
          project: { cwd: input.workspaceRoot },
          worktreePath: input.worktreePath,
        }),
        timeout: ARCHIVE_SCRIPT_TIMEOUT,
        timeoutBehavior: "timedOutResult",
        maxOutputBytes: MAX_OUTPUT_BYTES,
        outputMode: "truncate",
      })
      .pipe(
        // A spawn or read failure is reported the same way a non-zero exit is:
        // the worktree stays, and the user decides whether to remove it anyway.
        Effect.mapError((cause) =>
          failure({ timedOut: false, stdout: "", stderr: describeProcessFailure(cause) }),
        ),
      );

    if (result.timedOut) {
      return yield* failure({
        timedOut: true,
        stdout: result.stdout,
        stderr: result.stderr,
      });
    }
    if (result.code !== 0) {
      return yield* failure({
        timedOut: false,
        stdout: result.stdout,
        stderr: result.stderr,
        ...(result.code === null ? {} : { exitCode: result.code }),
      });
    }

    return { status: "ok", scriptName: script.name } as const;
  });

  return WorktreeArchiveScriptRunner.of({ run });
});

export const layer = Layer.effect(WorktreeArchiveScriptRunner, make);

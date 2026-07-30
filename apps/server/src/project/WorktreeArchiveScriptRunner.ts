/**
 * WorktreeArchiveScriptRunner - runs a project's `runOnWorktreeRemove` script to
 * completion before its worktree is removed.
 *
 * Scripts come from the checked-in `t3.json` rather than the imported project
 * scripts, so editing that file takes effect on the next removal with no
 * re-import. A repository without `t3.json`, or without a flagged script,
 * resolves to `no-script` and the removal proceeds untouched.
 *
 * @module WorktreeArchiveScriptRunner
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { type ProjectScript, WorktreeArchiveScriptError } from "@t3tools/contracts";
import { isHostWindows } from "@t3tools/shared/hostProcess";
import {
  projectScriptRuntimeEnv,
  worktreeRemoveProjectScript,
  worktreeRemoveScript,
} from "@t3tools/shared/projectScripts";

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
  /**
   * The project's IMPORTED scripts, consulted only when no checked-in `t3.json`
   * flags one. Passed in rather than queried so this service keeps a two-service
   * dependency graph and stays trivial to construct in tests.
   */
  readonly importedScripts?: readonly ProjectScript[] | undefined;
}

export type WorktreeArchiveScriptRunnerResult =
  | { readonly status: "no-script" }
  | { readonly status: "ok"; readonly scriptName: string };

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

  const run: WorktreeArchiveScriptRunner["Service"]["run"] = Effect.fn(
    "WorktreeArchiveScriptRunner.run",
  )(function* (input) {
    // Resolution order, most specific first:
    //   1. the WORKTREE's t3.json — it is the checkout being torn down, and the
    //      script that runs is its file too (relative command, cwd = worktree),
    //      so config and script stay on one branch;
    //   2. the project root's t3.json — a branch made before the file existed;
    //   3. the project's IMPORTED scripts, which the scripts dialog's toggle
    //      writes, for projects that check nothing in.
    const worktreeFile = yield* projectFileLoader.load(input.worktreePath);
    const rootFile = Option.isSome(worktreeFile)
      ? worktreeFile
      : yield* projectFileLoader.load(input.workspaceRoot);
    const fileScript = Option.isSome(rootFile)
      ? worktreeRemoveProjectScript(rootFile.value.scripts ?? [])
      : null;

    const script = fileScript ?? worktreeRemoveScript(input.importedScripts ?? []);
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
        // The worktree is still on disk here — the whole point of running before
        // removal — so the script can reach its own compose file and env.
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
        Effect.mapError((cause) => failure({ timedOut: false, stdout: "", stderr: `${cause}` })),
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

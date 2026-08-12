import { EnvironmentId, ThreadId, WorktreeArchiveScriptError } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { archiveScriptOutcome, ThreadArchiveBlockedError } from "./useThreadActions";

describe("ThreadArchiveBlockedError", () => {
  it("keeps the blocked thread context with the fixed message", () => {
    const error = new ThreadArchiveBlockedError({
      environmentId: EnvironmentId.make("environment-1"),
      threadId: ThreadId.make("thread-1"),
    });

    expect(error).toMatchObject({
      environmentId: "environment-1",
      threadId: "thread-1",
    });
    expect(error.message).toBe("Cannot archive a running thread.");
  });
});

describe("archiveScriptOutcome", () => {
  it("reports a run when the script ran", () => {
    expect(archiveScriptOutcome(AsyncResult.success({ ran: true }))).toEqual({ kind: "ran" });
  });

  it("reports nothing to do when no script ran", () => {
    // The project has no archive script, or the worktree folder is already
    // gone. Saying "Workspace services stopped" here reports work nobody did.
    expect(archiveScriptOutcome(AsyncResult.success({ ran: false }))).toEqual({
      kind: "nothing-to-do",
    });
  });

  it("reports a run when the server is too old to say whether the script ran", () => {
    expect(archiveScriptOutcome(AsyncResult.success(undefined))).toEqual({ kind: "ran" });
  });

  it("reports the failure when the script failed", () => {
    const error = new WorktreeArchiveScriptError({
      scriptName: "Archive workspace",
      command: "bash .agents/workspaces/archive.sh",
      worktreePath: "/repo/worktrees/a",
      exitCode: 1,
      timedOut: false,
      stdout: "",
      stderr: "compose down failed",
    });

    expect(archiveScriptOutcome(AsyncResult.failure(Cause.fail(error)))).toEqual({
      kind: "failed",
      error,
    });
  });
});

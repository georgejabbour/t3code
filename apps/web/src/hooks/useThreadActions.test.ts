import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { EnvironmentId, ThreadId, WorktreeArchiveScriptError } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  archiveScriptOutcome,
  navigateAfterThreadDeletion,
  requestThreadUnpinConfirmation,
  ThreadArchiveBlockedError,
} from "./useThreadActions";
import { toastManager } from "../components/ui/toast";

describe("navigateAfterThreadDeletion", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reports a rejected navigation without failing the completed deletion", async () => {
    const addToast = vi.spyOn(toastManager, "add").mockReturnValue("navigation-error");

    await expect(
      navigateAfterThreadDeletion(() => Promise.reject(new Error("route unavailable"))),
    ).resolves.toBeUndefined();

    expect(addToast).toHaveBeenCalledOnce();
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Thread deleted, but navigation failed",
        description: "route unavailable",
      }),
    );
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

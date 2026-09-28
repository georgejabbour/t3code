import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId, TurnId } from "@t3tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { getDocumentTitle } from "./documentTitle";
import type { SidebarThreadSummary } from "./types";

const before = "2026-09-28T10:00:00.000Z";
const after = "2026-09-28T11:00:00.000Z";
const thread: SidebarThreadSummary = {
  id: ThreadId.make("thread"),
  environmentId: EnvironmentId.make("local"),
  projectId: ProjectId.make("project"),
  title: "Thread",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  pullRequests: [],
  createdAt: before,
  updatedAt: after,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  session: null,
  latestUserMessageAt: before,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  latestTurn: {
    turnId: TurnId.make("turn"),
    state: "completed",
    requestedAt: before,
    startedAt: before,
    completedAt: after,
    assistantMessageId: null,
  },
};
const key = (value: SidebarThreadSummary) =>
  scopedThreadKey(scopeThreadRef(value.environmentId, value.id));
const visits = { [key(thread)]: before };

describe("getDocumentTitle", () => {
  it("counts unseen completions across environments with the same thread ID", () => {
    const remote = { ...thread, environmentId: EnvironmentId.make("remote") };
    expect(
      getDocumentTitle("T3 Code (Nightly)", [thread, remote], {
        ...visits,
        [key(remote)]: before,
      }),
    ).toBe("(2) T3 Code (Nightly)");
    expect(
      getDocumentTitle("T3 Code", [thread, remote], {
        ...visits,
        [key(remote)]: after,
      }),
    ).toBe("(1) T3 Code");
  });

  it("clears the count after a visit and restores it when marked unread", () => {
    expect(getDocumentTitle("T3 Code", [thread], visits)).toBe("(1) T3 Code");
    expect(getDocumentTitle("T3 Code", [thread], { [key(thread)]: after })).toBe("T3 Code");
    expect(getDocumentTitle("T3 Code", [thread], visits)).toBe("(1) T3 Code");
  });

  it("does not count historical threads without a recorded visit", () => {
    expect(getDocumentTitle("T3 Code", [thread], {})).toBe("T3 Code");
    expect(getDocumentTitle("T3 Code", [], visits)).toBe("T3 Code");
  });

  it.each<Partial<SidebarThreadSummary>>([
    { archivedAt: after },
    { settledOverride: "settled" },
    { latestTurn: null },
    { latestTurn: { ...thread.latestTurn!, state: "error" } },
    { latestTurn: { ...thread.latestTurn!, state: "interrupted" } },
    { latestTurn: { ...thread.latestTurn!, state: "running", completedAt: null } },
    { backgroundLiveness: "working" },
    { backgroundLiveness: "monitoring" },
    { hasPendingApprovals: true },
    { hasPendingUserInput: true },
  ])("excludes threads that do not await a completed-response visit: %j", (overrides) => {
    expect(getDocumentTitle("T3 Code", [{ ...thread, ...overrides }], visits)).toBe("T3 Code");
  });
});

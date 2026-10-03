import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId, RunId } from "@t3tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { getDocumentTitle } from "./documentTitle";
import type { SidebarThreadSummary } from "./types";
import { makeThreadFixture } from "./test-fixtures";

const before = "2026-09-28T10:00:00.000Z";
const after = "2026-09-28T11:00:00.000Z";
const thread: SidebarThreadSummary = makeThreadFixture({
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
  runtime: null,
  latestUserMessageAt: before,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  latestRun: {
    runId: RunId.make("run"),
    status: "completed",
    requestedAt: before,
    startedAt: before,
    completedAt: after,
    assistantMessageId: null,
  },
});
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

  it.each(["hasPendingApprovals", "hasPendingUserInput"] as const)(
    "counts %s until resolved, regardless of visits or turn completion",
    (flag) => {
      const pending = { ...thread, [flag]: true };
      expect(getDocumentTitle("T3 Code", [pending], visits)).toBe("(1) T3 Code");
      expect(getDocumentTitle("T3 Code", [pending], { [key(thread)]: after })).toBe("(1) T3 Code");
      expect(getDocumentTitle("T3 Code", [{ ...pending, latestRun: null }], {})).toBe(
        "(1) T3 Code",
      );
      expect(
        getDocumentTitle("T3 Code", [{ ...pending, [flag]: false }], {
          [key(thread)]: after,
        }),
      ).toBe("T3 Code");
      expect(getDocumentTitle("T3 Code", [{ ...pending, archivedAt: after }], visits)).toBe(
        "T3 Code",
      );
      expect(
        getDocumentTitle("T3 Code", [{ ...pending, settledOverride: "settled" }], visits),
      ).toBe("T3 Code");
    },
  );

  it("counts a thread once when it has both input and approval requests", () => {
    expect(
      getDocumentTitle(
        "T3 Code",
        [
          {
            ...thread,
            hasPendingApprovals: true,
            hasPendingUserInput: true,
          },
        ],
        visits,
      ),
    ).toBe("(1) T3 Code");
  });

  it("keeps a ready plan counted after a visit until the decision is resolved", () => {
    const plan: SidebarThreadSummary = {
      ...thread,
      interactionMode: "plan",
      hasActionableProposedPlan: true,
    };
    const read = { [key(plan)]: after };
    expect(getDocumentTitle("T3 Code", [plan], visits)).toBe("(1) T3 Code");
    expect(getDocumentTitle("T3 Code", [plan], read)).toBe("(1) T3 Code");
    expect(getDocumentTitle("T3 Code", [plan], {})).toBe("(1) T3 Code");
    expect(
      getDocumentTitle(
        "T3 Code",
        [
          {
            ...plan,
            pendingBackgroundTasks: [
              { taskId: "background", description: "Work", kind: "command" },
            ],
          },
        ],
        read,
      ),
    ).toBe("(1) T3 Code");
    expect(getDocumentTitle("T3 Code", [{ ...plan, hasActionableProposedPlan: false }], read)).toBe(
      "T3 Code",
    );
    expect(getDocumentTitle("T3 Code", [{ ...plan, interactionMode: "default" }], read)).toBe(
      "T3 Code",
    );
    expect(
      getDocumentTitle(
        "T3 Code",
        [
          {
            ...plan,
            latestRun: {
              ...thread.latestRun!,
              status: "running",
              completedAt: null,
            },
          },
        ],
        read,
      ),
    ).toBe("T3 Code");
    expect(getDocumentTitle("T3 Code", [{ ...plan, archivedAt: after }], read)).toBe("T3 Code");
    expect(getDocumentTitle("T3 Code", [{ ...plan, settledOverride: "settled" }], read)).toBe(
      "T3 Code",
    );
  });

  it.each<Partial<SidebarThreadSummary>>([
    { archivedAt: after },
    { settledOverride: "settled" },
    { latestRun: null },
    { latestRun: { ...thread.latestRun!, status: "failed" } },
    { latestRun: { ...thread.latestRun!, status: "interrupted" } },
    { latestRun: { ...thread.latestRun!, status: "running", completedAt: null } },
    { pendingBackgroundTasks: [{ taskId: "background", description: "Work", kind: "command" }] },
    {
      runtime: {
        status: "idle",
        activeRunId: null,
        providerInstanceId: thread.modelSelection.instanceId,
        providerName: null,
        lastError: null,
        updatedAt: after,
      },
    },
  ])("excludes threads that do not await a completed-response visit: %j", (overrides) => {
    expect(getDocumentTitle("T3 Code", [{ ...thread, ...overrides }], visits)).toBe("T3 Code");
  });
});

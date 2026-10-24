import {
  AuthOrchestrationOperateScope,
  AuthSourceControlWriteScope,
  EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { memo, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { act, render } from "../../test/render";

type Branched = { readonly branch: string };
type GitActionInput = {
  featureBranch?: boolean;
  noVerify?: boolean;
  threadId?: string;
  action: string;
};
type Toast = { title?: string; description?: string; actionProps?: { onClick: () => void } };

const state = vi.hoisted(() => ({
  scopes: new Set<string>(),
  primaryScopes: new Set<string>(),
  shell: null as Branched | null,
  detail: null as Branched | null,
  draft: null as (Branched & { worktreePath: string | null; envMode: "local" | "worktree" }) | null,
  branch: "main" as string | null,
  isRepo: true,
  hasUpstream: true,
  isGitActionRunning: false,
  pulls: [] as { environmentId: string | null; cwd: string | null }[],
  pullError: null as string | null,
  pullStatus: "pulled" as "pulled" | "skipped_up_to_date",
  isDefaultRef: false,
  actions: [] as { scope: { cwd: string | null }; input: GitActionInput }[],
  metadataRequests: [] as { environmentId: string; branch: string }[],
  toasts: [] as Toast[],
  afterGitAction: undefined as (() => void) | undefined,
  workingTreeRoot: undefined as string | undefined,
  files: [{ path: "file.ts", insertions: 1, deletions: 0 }],
  editorOpens: [] as { environmentId: string; input: { cwd: string; editor: string } }[],
}));

vi.mock(import("~/state/session"), async (original) => {
  const hasScope = (environmentId: unknown, scope: string) =>
    (environmentId === "environment" ? state.scopes : state.primaryScopes).has(scope);
  return {
    ...(await original()),
    useEnvironmentScope: hasScope as never,
    readEnvironmentScope: hasScope as never,
  };
});
vi.mock(import("~/state/entities"), async (original) => ({
  ...(await original()),
  useQuietThreadShell: ((ref: { threadId: string } | null) =>
    ref === null || state.shell === null ? null : { ...state.shell, id: ref.threadId }) as never,
  useThreadProjection: ((ref: unknown) =>
    ref === null || state.detail === null
      ? null
      : { projection: { thread: state.detail } }) as never,
}));
vi.mock(import("~/state/query"), async (original) => ({
  ...(await original()),
  // Serves both the VCS status and the source-control discovery queries.
  useEnvironmentQuery: (() => ({
    data: {
      sourceControlProviders: [],
      isRepo: state.isRepo,
      refName: state.branch,
      isDefaultRef: state.isDefaultRef,
      hasPrimaryRemote: true,
      hasWorkingTreeChanges: true,
      workingTree: {
        ...(state.workingTreeRoot === undefined ? {} : { rootPath: state.workingTreeRoot }),
        files: state.files,
        insertions: 1,
        deletions: 0,
      },
      hasUpstream: state.hasUpstream,
      aheadCount: 0,
      behindCount: 0,
      pr: null,
    },
    error: null,
  })) as never,
}));
vi.mock(import("~/state/use-atom-command"), async (original) => {
  const { shellEnvironment } = await import("~/state/shell");
  return {
    ...(await original()),
    // Only the thread's branch metadata update and editor opens are observed here.
    useAtomCommand: ((command: unknown, options: unknown) =>
      options === "thread branch metadata update"
        ? async ({
            environmentId,
            input,
          }: {
            environmentId: string;
            input: { branch: string };
          }) => {
            state.metadataRequests.push({ environmentId, branch: input.branch });
            if (!state.scopes.has(AuthOrchestrationOperateScope))
              return AsyncResult.failure(Cause.fail(new Error("Task denied")));
            if (state.shell) state.shell = { branch: input.branch };
            if (state.detail) state.detail = { branch: input.branch };
            return AsyncResult.success(undefined);
          }
        : command === shellEnvironment.openInEditor
          ? async (request: (typeof state.editorOpens)[number]) => {
              state.editorOpens.push(request);
              return AsyncResult.success(undefined);
            }
          : async () => AsyncResult.success(undefined)) as never,
  };
});
// The preferred-editor flow needs one editor the environment reports as installed.
vi.mock(import("~/state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const config = Atom.make(() => ({ availableEditors: ["cursor"] }));
  return {
    ...actual,
    serverEnvironment: { ...actual.serverEnvironment, configValueAtom: (() => config) as never },
  };
});
vi.mock(import("~/lib/sourceControlActions"), async (original) => ({
  ...(await original()),
  useSourceControlActionRunning: () => state.isGitActionRunning,
  useVcsPullAction: ((scope: (typeof state.pulls)[number]) => ({
    run: async () => {
      state.pulls.push(scope);
      return state.pullError
        ? AsyncResult.failure(Cause.fail(new Error(state.pullError)))
        : AsyncResult.success({
            status: state.pullStatus,
            refName: state.branch,
            upstreamRef: `origin/${state.branch}`,
          });
    },
  })) as never,
  useGitStackedAction: ((scope: { cwd: string | null }) => ({
    run: async (input: GitActionInput) => {
      state.actions.push({ scope, input });
      if (input.featureBranch) state.branch = "feature";
      state.afterGitAction?.();
      return {
        _tag: "Success",
        value: {
          branch: input.featureBranch
            ? { status: "created", name: "feature" }
            : { status: "skipped_not_requested" },
          toast: {
            title: "Committed",
            description: "Committed",
            cta: {
              kind: "run_action",
              label: "Push & create PR",
              action: { kind: "commit_push_pr" },
            },
          },
        },
      };
    },
  })) as never,
}));
vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useNavigate: (() => async () => {}) as never,
}));
vi.mock(import("~/components/ui/toast"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    toastManager: {
      ...actual.toastManager,
      add: ((toast: Toast) => {
        state.toasts.push(toast);
        return "toast";
      }) as never,
    },
  };
});

import { useComposerDraftStore } from "~/composerDraftStore";
import GitActionsControl from "./GitActionsControl";

// ThreadDetailsPanel keeps this component mounted behind React.memo when threads change.
const MemoGitActionsControl = memo(GitActionsControl);

function control(
  thread = "thread",
  cwd = "/repo",
  props: Pick<ComponentProps<typeof GitActionsControl>, "displayMode" | "compact"> = {},
) {
  return (
    <MemoGitActionsControl
      gitCwd={cwd}
      activeThreadRef={{
        environmentId: EnvironmentId.make("environment"),
        threadId: ThreadId.make(thread),
      }}
      {...props}
    />
  );
}

const button = (name: string | RegExp) =>
  page.getByRole("button", { name, exact: typeof name === "string" });
const commits = () => state.actions.length;

// The mocked modules read `state`, so every test starts by resetting all of it.
function setup() {
  localStorage.clear();
  state.scopes = new Set([AuthSourceControlWriteScope]);
  state.primaryScopes = new Set([AuthSourceControlWriteScope, AuthOrchestrationOperateScope]);
  state.shell = { branch: "main" };
  state.detail = null;
  state.draft = null;
  state.branch = "main";
  state.isRepo = true;
  state.hasUpstream = true;
  state.isGitActionRunning = false;
  state.pulls = [];
  state.pullError = null;
  state.pullStatus = "pulled";
  state.isDefaultRef = false;
  state.actions = [];
  state.metadataRequests = [];
  state.toasts = [];
  state.afterGitAction = undefined;
  state.workingTreeRoot = undefined;
  state.files = [{ path: "file.ts", insertions: 1, deletions: 0 }];
  state.editorOpens = [];
  useComposerDraftStore.setState({
    getDraftSession: () => state.draft as never,
    getDraftThreadByRef: () => state.draft as never,
    setDraftThreadContext: (_target, input) => {
      if (state.draft && input.branch) state.draft = { ...state.draft, branch: input.branch };
    },
  });
}

describe("Draft checkout pull", () => {
  function setupDraft() {
    setup();
    state.shell = null;
    state.draft = { branch: "main", worktreePath: null, envMode: "local" };
  }

  it("pulls with local edits and no known incoming commits, then confirms the result", async () => {
    setupDraft();
    await using _screen = await render(control("draft", "/repo", { displayMode: "panel" }));
    await expect.element(button("Pull latest")).toBeEnabled();

    await userEvent.click(button("Pull latest"));

    await expect.element(page.getByText("Pulled", { exact: true })).toBeVisible();
    await expect
      .element(page.getByText("Updated main from origin/main", { exact: true }))
      .toBeVisible();
    expect(state.pulls).toEqual([{ environmentId: "environment", cwd: "/repo" }]);
    expect(state.actions).toEqual([]);
    expect(state.metadataRequests).toEqual([]);
  });

  it("uses the current checkout when selecting a base for a new worktree", async () => {
    setupDraft();
    state.draft = { branch: "release/next", worktreePath: null, envMode: "worktree" };
    state.pullStatus = "skipped_up_to_date";
    await using _screen = await render(
      control("draft", "/repo", { displayMode: "panel", compact: true }),
    );

    await userEvent.click(button("Pull latest"));

    await expect.element(page.getByText("Already up to date", { exact: true })).toBeVisible();
    expect(state.pulls).toEqual([{ environmentId: "environment", cwd: "/repo" }]);
    expect(state.draft.branch).toBe("release/next");
  });

  it("shows pull failures and allows another attempt", async () => {
    setupDraft();
    state.pullError = "Local changes would be overwritten by merge.";
    await using _screen = await render(control("draft", "/repo", { displayMode: "panel" }));

    await userEvent.click(button("Pull latest"));

    await vi.waitFor(() =>
      expect(state.toasts).toContainEqual(
        expect.objectContaining({
          title: "Pull failed",
          description: state.pullError,
        }),
      ),
    );
    await expect.element(button("Pull latest")).toBeEnabled();
    state.pullError = null;
    await userEvent.click(button("Pull latest"));
    await expect.element(page.getByText("Pulled", { exact: true })).toBeVisible();
    expect(state.pulls).toHaveLength(2);
  });

  it.each(["no upstream", "detached HEAD", "read only", "busy"])(
    "disables pull when %s",
    async (condition) => {
      setupDraft();
      if (condition === "no upstream") state.hasUpstream = false;
      if (condition === "detached HEAD") state.branch = null;
      if (condition === "read only") state.scopes.clear();
      if (condition === "busy") state.isGitActionRunning = true;
      await using _screen = await render(control("draft", "/repo", { displayMode: "panel" }));

      await expect.element(button("Pull latest")).toBeDisabled();
      expect(state.pulls).toEqual([]);
    },
  );

  it("does not show draft pull on an existing thread or outside a repository", async () => {
    setupDraft();
    state.shell = { branch: "main" };
    state.draft = null;
    await using screen = await render(control("thread", "/repo", { displayMode: "panel" }));
    await expect.element(button("Pull latest")).not.toBeInTheDocument();

    state.shell = null;
    state.draft = { branch: "main", worktreePath: null, envMode: "local" };
    state.isRepo = false;
    await screen.rerender(control("draft", "/other", { displayMode: "panel" }));
    await expect.element(button("Pull latest")).not.toBeInTheDocument();
  });
});

describe("Default branch prompt", () => {
  function setupDefaultRef() {
    setup();
    state.isDefaultRef = true;
    state.scopes.add(AuthOrchestrationOperateScope);
  }

  it("preserves No verify when continuing on a feature branch", async () => {
    setupDefaultRef();
    await using _screen = await render(control());
    await userEvent.click(button("Git action options"));
    const noVerify = page.getByRole("menuitemcheckbox", { name: "No verify" });
    await expect.element(noVerify).not.toBeChecked();
    await userEvent.click(noVerify);
    await expect.element(noVerify).toBeChecked();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(button(/^Commit & push/));
    await userEvent.click(button("Check out feature branch & continue"));

    await vi.waitFor(() =>
      expect(state.actions[0]?.input).toMatchObject({
        action: "commit_push",
        featureBranch: true,
        noVerify: true,
      }),
    );
  });
});

describe("Git action targets across thread navigation", () => {
  const quickAction = () => button(/^Commit, push & /);

  it("remembers the last No verify setting after remounting in another workspace", async () => {
    setup();
    const noVerify = page.getByRole("menuitemcheckbox", { name: "No verify" });

    for (const enabled of [true, false]) {
      await using screen = await render(
        control(enabled ? "thread" : "second", enabled ? "/repo" : "/second"),
      );
      await userEvent.click(button("Git action options"));
      await userEvent.click(noVerify);
      await userEvent.keyboard("{Escape}");

      await screen.unmount();
      await using _remounted = await render(
        control(enabled ? "second" : "third", enabled ? "/second" : "/third"),
      );
      await userEvent.click(button("Git action options"));
      if (enabled) {
        await expect.element(noVerify).toBeChecked();
      } else {
        await expect.element(noVerify).not.toBeChecked();
      }
      await userEvent.keyboard("{Escape}");
    }
  });

  it("uses one No verify setting across checkouts", async () => {
    setup();
    await using screen = await render(control("first", "/first"));
    await userEvent.click(button("Git action options"));
    const noVerify = page.getByRole("menuitemcheckbox", { name: "No verify" });
    await userEvent.click(noVerify);
    await userEvent.click(noVerify);
    await expect.element(noVerify).not.toBeChecked();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(quickAction());
    await vi.waitFor(() => expect(commits()).toBe(1));
    expect(state.actions[0]?.input.noVerify).not.toBe(true);

    await userEvent.click(button("Git action options"));
    await userEvent.click(noVerify);
    await userEvent.keyboard("{Escape}");
    await userEvent.click(quickAction());
    await vi.waitFor(() => expect(commits()).toBe(2));
    expect(state.actions[1]?.input.noVerify).toBe(true);

    await screen.rerender(control("second", "/second"));
    await userEvent.click(quickAction());
    await vi.waitFor(() => expect(commits()).toBe(3));
    expect(state.actions[2]?.input.noVerify).toBe(true);

    await userEvent.click(button("Git action options"));
    await userEvent.click(noVerify);
    await userEvent.keyboard("{Escape}");

    await screen.rerender(control("first", "/first"));
    await userEvent.click(quickAction());
    await vi.waitFor(() => expect(commits()).toBe(4));
    expect(state.actions[3]?.input.noVerify).not.toBe(true);
  });

  it("runs a retained PR toast in the thread that produced it", async () => {
    setup();
    await using screen = await render(control("first", "/first"));
    await userEvent.click(quickAction());
    await vi.waitFor(() => expect(state.toasts.some((toast) => toast.actionProps)).toBe(true));
    const toast = state.toasts.find((toast) => toast.actionProps)!;

    await screen.rerender(control("second", "/second"));
    await act(async () => toast.actionProps!.onClick());

    expect(state.actions.at(-1)).toMatchObject({
      scope: { cwd: "/first" },
      input: { threadId: "first", action: "commit_push_pr" },
    });
  });

  it("uses the current No verify option for a retained PR toast", async () => {
    setup();
    await using screen = await render(control("first", "/first"));
    await userEvent.click(button("Git action options"));
    await userEvent.click(page.getByRole("menuitemcheckbox", { name: "No verify" }));
    await userEvent.keyboard("{Escape}");
    await userEvent.click(quickAction());
    await vi.waitFor(() => expect(state.toasts.some((toast) => toast.actionProps)).toBe(true));
    expect(state.actions[0]?.input.noVerify).toBe(true);
    const toast = state.toasts.find((toast) => toast.actionProps)!;

    await screen.rerender(control("second", "/second"));
    await userEvent.click(button("Git action options"));
    await userEvent.click(page.getByRole("menuitemcheckbox", { name: "No verify" }));
    await userEvent.keyboard("{Escape}");
    await act(async () => toast.actionProps!.onClick());

    expect(state.actions.at(-1)).toMatchObject({
      scope: { cwd: "/first" },
      input: { threadId: "first", action: "commit_push_pr" },
    });
    expect(state.actions.at(-1)?.input.noVerify).not.toBe(true);
  });
});

import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type GitStackBranch,
  type GitStackView,
} from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { StackChainRows, chainRowPlan, chainRowTooltip } from "./GitStackChainCard";

// Added by this fork. See Patch 16 in PATCHES.md.

const threadRef = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};
const reference = {
  projectId: ProjectId.make("project-1"),
  repository: "owner/repo",
  number: 166,
};

function member(name: string, number: number, isCurrent: boolean): GitStackBranch {
  return {
    name,
    head: "",
    base: "",
    isCurrent,
    isMerged: false,
    isQueued: false,
    needsRebase: false,
    pr: { number, url: `https://github.com/owner/repo/pull/${number}`, state: "open" },
  };
}

/**
 * The chain George hit: three branches, and the checkout that answered the read
 * sits on the top one while the reader stands on the bottom one.
 */
function chain(currentBranch: string): GitStackView {
  return {
    trunk: "develop",
    currentBranch,
    branches: [
      member("george/nrg-451", 166, currentBranch === "george/nrg-451"),
      member("george/nrg-454", 167, currentBranch === "george/nrg-454"),
      member("george/nrg-459", 169, currentBranch === "george/nrg-459"),
    ],
  };
}

/**
 * The markup of each row, so a test can say which row carries a mark. Split on a
 * whole `<li` tag: the pull request icon draws `<line>` elements, and a plain
 * `"<li"` search cuts a row in half at the first one.
 */
function rows(markup: string): ReadonlyArray<string> {
  return markup.split(/<li[\s>]/).slice(1);
}

function rowFor(markup: string, branchName: string): string {
  const found = rows(markup).find((row) => row.includes(branchName));
  expect(found).toBeDefined();
  return found ?? "";
}

describe("StackChainRows", () => {
  it("marks only the branch the reader's own worktree sits on, not the checkout that answered the read", () => {
    const markup = renderToStaticMarkup(
      <StackChainRows
        view={chain("george/nrg-459")}
        threadBranch="george/nrg-451"
        viewingBranch="george/nrg-451"
        rowAction="checkout-and-open"
        disabled={false}
        onSelect={() => undefined}
      />,
    );

    expect(markup.split('data-testid="git-stack-chain-here"')).toHaveLength(2);
    expect(rowFor(markup, "george/nrg-451")).toContain('data-testid="git-stack-chain-here"');
    expect(rowFor(markup, "george/nrg-459")).not.toContain('data-testid="git-stack-chain-here"');
  });

  it("marks no branch when the card speaks for no working tree", () => {
    const markup = renderToStaticMarkup(
      <StackChainRows
        view={chain("george/nrg-459")}
        threadBranch={null}
        viewingBranch="george/nrg-451"
        rowAction="open"
        disabled={false}
        onSelect={() => undefined}
      />,
    );

    expect(markup).not.toContain('data-testid="git-stack-chain-here"');
  });

  it("marks the row the panel shows as the current one", () => {
    const markup = renderToStaticMarkup(
      <StackChainRows
        view={chain("george/nrg-451")}
        threadBranch="george/nrg-451"
        viewingBranch="george/nrg-459"
        rowAction="checkout-and-open"
        disabled={false}
        onSelect={() => undefined}
      />,
    );

    expect(rowFor(markup, "george/nrg-459")).toContain("aria-current");
    expect(rowFor(markup, "george/nrg-451")).not.toContain("aria-current");
    expect(rowFor(markup, "george/nrg-451")).toContain('data-testid="git-stack-chain-here"');
  });
});

describe("chainRowPlan", () => {
  it("checks out and opens when the card has a thread to move", () => {
    expect(chainRowPlan({ threadRef, threadCwd: "/repo/worktree", reference })).toEqual({
      action: "checkout-and-open",
      threadRef,
      threadCwd: "/repo/worktree",
      reference,
    });
  });

  it.each([
    ["no thread", { threadRef: null, threadCwd: "/repo/worktree", reference }],
    ["no worktree", { threadRef, threadCwd: null, reference }],
    ["no repository", { threadRef, threadCwd: "/repo/worktree", reference: null }],
  ])("only opens the pull request with %s", (_case, input) => {
    expect(chainRowPlan(input)).toEqual({ action: "open" });
  });
});

describe("chainRowTooltip", () => {
  it("promises the checkout the click will perform", () => {
    expect(chainRowTooltip("checkout-and-open", "george/nrg-451", 166)).toBe(
      "Check out george/nrg-451 here and open pull request #166",
    );
  });

  it("promises no checkout when the click will not perform one", () => {
    const tooltip = chainRowTooltip("open", "george/nrg-451", 166);
    expect(tooltip).toBe("Open pull request #166");
    expect(tooltip).not.toContain("Check out");
  });
});

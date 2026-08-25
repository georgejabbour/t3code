import { describe, expect, it } from "@effect/vitest";

import {
  branchesAbove,
  findWorktreeForBranch,
  parseWorktreeList,
  stackProbeOrder,
} from "./GitStackService.ts";
import { normalizeStackView, parseStackViewJson, stderrTail } from "./GhStackCli.ts";

// Added by this fork. See Patch 16 in PATCHES.md.

const capturedView = `{
  "trunk": "main",
  "currentBranch": "api",
  "branches": [
    {
      "name": "auth",
      "base": "ddd4444",
      "base": "ddd4444",
      "isCurrent": false,
      "isMerged": false,
      "isQueued": false,
      "needsRebase": false
    },
    {
      "name": "api",
      "head": "bbb2222",
      "base": "aaa1111",
      "isCurrent": true,
      "isMerged": false,
      "isQueued": false,
      "needsRebase": true,
      "pr": { "number": 42, "url": "https://github.com/o/r/pull/42", "state": "OPEN" }
    },
    {
      "name": "frontend",
      "head": "ccc3333",
      "base": "bbb2222",
      "isCurrent": false,
      "isMerged": false,
      "isQueued": false,
      "needsRebase": false,
      "pr": { "number": 43, "url": "https://github.com/o/r/pull/43", "state": "MERGED" }
    }
  ]
}`;

describe("normalizeStackView", () => {
  it("lower-cases pull request states and fills the absent pr with null", () => {
    const view = normalizeStackView(JSON.parse(capturedView));
    expect(view.branches[0]?.pr).toBeNull();
    expect(view.branches[1]?.pr?.state).toBe("open");
    expect(view.branches[2]?.pr?.state).toBe("merged");
  });

  it("reads a checkout sitting on the trunk as no chain branch current", () => {
    const raw = { ...(JSON.parse(capturedView) as Record<string, unknown>), currentBranch: "main" };
    const view = normalizeStackView(raw as unknown as Parameters<typeof normalizeStackView>[0]);
    expect(view.currentBranch).toBeNull();
  });
});

describe("parseStackViewJson", () => {
  it("decodes a captured gh stack view answer", () => {
    const decoded = parseStackViewJson(capturedView);
    expect(decoded._tag).toBe("Success");
  });

  it("refuses output that is not a stack description", () => {
    expect(parseStackViewJson("not json")._tag).toBe("Failure");
  });
});

describe("parseWorktreeList", () => {
  it("pairs every worktree path with its branch", () => {
    const checkouts = parseWorktreeList(
      [
        "worktree /repo",
        "HEAD aaa1111",
        "",
        "worktree /wt/one",
        "HEAD bbb2222",
        "branch refs/heads/auth",
        "",
        "worktree /wt/two",
        "HEAD ccc3333",
        "detached",
        "",
      ].join("\n"),
    );
    expect(checkouts).toEqual([
      { path: "/repo", branch: null, prunable: false },
      { path: "/wt/one", branch: "auth", prunable: false },
      { path: "/wt/two", branch: null, prunable: false },
    ]);
  });

  it("marks the checkout whose directory git says is gone", () => {
    const checkouts = parseWorktreeList(
      [
        "worktree /wt/gone",
        "HEAD bbb2222",
        "branch refs/heads/auth",
        "prunable gitdir file points to non-existent location",
        "",
        "worktree /wt/here",
        "HEAD ccc3333",
        "branch refs/heads/api",
        "",
      ].join("\n"),
    );
    expect(checkouts.map((checkout) => checkout.prunable)).toEqual([true, false]);
  });
});

describe("findWorktreeForBranch", () => {
  const checkouts = parseWorktreeList(
    [
      "worktree /repo",
      "HEAD aaa1111",
      "",
      "worktree /wt/one",
      "HEAD bbb2222",
      "branch refs/heads/george/nrg-435",
      "",
    ].join("\n"),
  );

  it("names the checkout holding the branch", () => {
    expect(findWorktreeForBranch(checkouts, "george/nrg-435")).toBe("/wt/one");
  });

  it("answers null when no checkout holds the branch", () => {
    expect(findWorktreeForBranch(checkouts, "george/nrg-999")).toBeNull();
  });
});

describe("stackProbeOrder", () => {
  // The extension tracks a stack inside one checkout's git directory, so a read
  // has to ask several checkouts. These cases fix the order and the exclusions.
  const checkouts = parseWorktreeList(
    [
      "worktree /repo",
      "HEAD aaa1111",
      "branch refs/heads/develop",
      "",
      "worktree /wt/tracking",
      "HEAD bbb2222",
      "branch refs/heads/george/nrg-435",
      "",
      "worktree /wt/holder",
      "HEAD ccc3333",
      "branch refs/heads/george/nrg-439",
      "",
      "worktree /wt/detached",
      "HEAD ddd4444",
      "detached",
      "",
      "worktree /wt/gone",
      "HEAD eee5555",
      "branch refs/heads/george/nrg-444",
      "prunable gitdir file points to non-existent location",
      "",
    ].join("\n"),
  );

  it("asks the checkout holding the branch before any other", () => {
    expect(stackProbeOrder(checkouts, "/repo", "george/nrg-439")[0]).toBe("/wt/holder");
  });

  it("leaves out the caller, detached checkouts, and prunable ones", () => {
    expect(stackProbeOrder(checkouts, "/repo", "george/nrg-439")).toEqual([
      "/wt/holder",
      "/wt/tracking",
    ]);
  });

  it("still asks the other checkouts when none holds the branch", () => {
    expect(stackProbeOrder(checkouts, "/repo", "george/nrg-999")).toEqual([
      "/wt/tracking",
      "/wt/holder",
    ]);
  });

  it("caps the list so a repository of many worktrees costs a few reads", () => {
    const many = parseWorktreeList(
      Array.from({ length: 20 }, (_, index) =>
        [`worktree /wt/${index}`, "HEAD aaa1111", `branch refs/heads/topic-${index}`, ""].join(
          "\n",
        ),
      ).join("\n"),
    );
    expect(stackProbeOrder(many, "/repo", "topic-19", 8)).toHaveLength(8);
  });
});

describe("branchesAbove", () => {
  const view = normalizeStackView(JSON.parse(capturedView));

  it("names every branch the current one sits on top of", () => {
    expect(branchesAbove(view, "api").map((branch) => branch.name)).toEqual(["frontend"]);
  });

  it("guards the whole chain when the checkout names no chain branch", () => {
    expect(branchesAbove(view, "main").map((branch) => branch.name)).toEqual([
      "auth",
      "api",
      "frontend",
    ]);
  });
});

describe("stderrTail", () => {
  it("keeps only the trailing lines of long output", () => {
    const lines = Array.from({ length: 30 }, (_, index) => `line ${index}`);
    const tail = stderrTail(lines.join("\n"));
    expect(tail.split("\n")).toHaveLength(12);
    expect(tail.startsWith("line 18")).toBe(true);
  });
});

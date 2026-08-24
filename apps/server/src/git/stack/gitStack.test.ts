import { describe, expect, it } from "@effect/vitest";

import { branchesAbove, parseWorktreeList } from "./GitStackService.ts";
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
      { path: "/repo", branch: null },
      { path: "/wt/one", branch: "auth" },
      { path: "/wt/two", branch: null },
    ]);
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

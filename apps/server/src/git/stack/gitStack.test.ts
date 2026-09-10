import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as GitStackService from "./GitStackService.ts";
import * as GhStackCli from "./GhStackCli.ts";
import * as VcsProcess from "../../vcs/VcsProcess.ts";

import {
  branchesAbove,
  findWorktreeForBranch,
  parseWorktreeList,
  stackProbeOrder,
} from "./GitStackService.ts";
import { normalizeStackView, parseStackViewJson, stderrTail } from "./GhStackCli.ts";

// Added by this fork. See Patch 16 in PATCHES.md.

const encodeUnknownJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

describe("stack merge preferences", () => {
  for (const mergeMethod of ["merge", "squash", "rebase", undefined] as const) {
    it.effect(`merges a stack with method ${mergeMethod ?? "omitted"}`, () => {
      let merged = false;
      const calls: VcsProcess.VcsProcessInput[] = [];
      const processLayer = Layer.succeed(VcsProcess.VcsProcess, {
        run: (input) =>
          Effect.gen(function* () {
            calls.push(input);
            expect(input.command).toBe("gh");
            expect(input.cwd).toBe("/repo");
            let stdout: string;
            if (input.args[1] === "view") {
              expect(input.args).toEqual(["stack", "view", "--json"]);
              stdout = yield* encodeUnknownJson({
                trunk: "main",
                currentBranch: "feature",
                branches: [
                  {
                    name: "feature",
                    head: "abc123",
                    base: "def456",
                    isCurrent: true,
                    isMerged: merged,
                    isQueued: false,
                    needsRebase: false,
                    pr: {
                      number: 42,
                      url: "https://github.com/o/r/pull/42",
                      state: merged ? "MERGED" : "OPEN",
                    },
                  },
                ],
              }).pipe(Effect.orDie);
            } else {
              expect(input.args).toEqual([
                "stack",
                "merge",
                "42",
                "--yes",
                ...(mergeMethod ? ["--merge-method", mergeMethod] : []),
              ]);
              expect(input.allowNonZeroExit).toBe(true);
              merged = true;
              stdout = "Merged pull request #42.";
            }
            return {
              exitCode: ChildProcessSpawner.ExitCode(0),
              stdout,
              stderr: "",
              stdoutTruncated: false,
              stderrTruncated: false,
            };
          }),
      });
      const serviceLayer = GitStackService.layer.pipe(
        Layer.provide(GhStackCli.layer),
        Layer.provide(processLayer),
        Layer.provideMerge(NodeServices.layer),
      );
      return Effect.gen(function* () {
        const service = yield* GitStackService.GitStackService;
        const before = yield* service.view({ cwd: "/repo" });
        expect(before?.branches[0]?.pr?.state).toBe("open");
        const result = yield* service.runAction({
          cwd: "/repo",
          action: "merge",
          prNumber: 42,
          ...(mergeMethod ? { mergeMethod } : {}),
        });
        expect(result.action).toBe("merge");
        expect(result.summary).toBe("Merged pull request #42.");
        expect(result.view.branches[0]?.pr?.state).toBe("merged");
        expect(calls.filter((call) => call.args[1] === "merge")).toHaveLength(1);
        expect(calls.filter((call) => call.args[1] === "view")).toHaveLength(2);
      }).pipe(Effect.provide(serviceLayer));
    });
  }
});

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

describe("stack discovery", () => {
  it.effect("finds saved stack state beyond the first eight worktrees", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const scratch = path.resolve(".scratch");
      yield* fileSystem.makeDirectory(scratch, { recursive: true });
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        directory: scratch,
        prefix: "git-stack-",
      });
      const trackingPath = path.join(cwd, "tracking");
      const gitDirectory = path.join(cwd, ".git", "worktrees", "tracking");
      yield* fileSystem.makeDirectory(trackingPath);
      yield* fileSystem.makeDirectory(gitDirectory, { recursive: true });
      yield* fileSystem.writeFileString(
        path.join(trackingPath, ".git"),
        "gitdir: ../.git/worktrees/tracking\n",
      );
      yield* fileSystem.writeFileString(
        path.join(gitDirectory, "gh-stack"),
        yield* encodeUnknownJson({
          stacks: [{ branches: [{ branch: "api" }, { branch: "frontend" }] }],
        }),
      );
      const checkouts = [
        ...Array.from({ length: 8 }, (_, index) => ({
          path: path.join(cwd, `other-${index}`),
          branch: `other-${index}`,
          prunable: false,
        })),
        { path: trackingPath, branch: "api", prunable: false },
      ];
      expect(stackProbeOrder(checkouts, cwd, "frontend")).not.toContain(trackingPath);
      const probedPaths: string[] = [];
      const processLayer = Layer.succeed(VcsProcess.VcsProcess, {
        run: (input) =>
          Effect.sync(() => {
            let stdout = "";
            let exitCode = 0;
            if (input.command === "git") {
              expect(input.args).toEqual(["worktree", "list", "--porcelain"]);
              stdout = checkouts
                .map((checkout) =>
                  [`worktree ${checkout.path}`, `branch refs/heads/${checkout.branch}`, ""].join(
                    "\n",
                  ),
                )
                .join("\n");
            } else {
              expect(input.command).toBe("gh");
              expect(input.args).toEqual(["stack", "view", "--json"]);
              probedPaths.push(input.cwd);
              stdout = input.cwd === trackingPath ? capturedView : "";
              exitCode = input.cwd === trackingPath ? 0 : 2;
            }
            return {
              exitCode: ChildProcessSpawner.ExitCode(exitCode),
              stdout,
              stderr: "",
              stdoutTruncated: false,
              stderrTruncated: false,
            };
          }),
      });
      const service = yield* GitStackService.make.pipe(
        Effect.provide(GhStackCli.layer.pipe(Layer.provide(processLayer))),
        Effect.provide(processLayer),
      );
      const view = yield* service.view({ cwd, branch: "frontend" });
      expect(view).toEqual(normalizeStackView(JSON.parse(capturedView)));
      expect(probedPaths).toEqual([cwd, trackingPath]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

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

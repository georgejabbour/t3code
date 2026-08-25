import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  GitStackCommandError,
  GitStackConflictError,
  GitStackPreflightError,
  type GitStackActionResult,
  type GitStackBranch,
  type GitStackError,
  type GitStackRunActionInput,
  type GitStackView,
} from "@t3tools/contracts";

import * as VcsProcess from "../../vcs/VcsProcess.ts";
import { stderrTail } from "./GhStackCli.ts";
import * as GhStackCli from "./GhStackCli.ts";

interface SafeReadOutcome {
  readonly exitCode: number;
  readonly stdout: string;
}

/**
 * Reads GitHub stacks and runs their non-interactive commands. Added by this
 * fork. See Patch 16 in PATCHES.md.
 *
 * The two safety rules live here rather than in the command layer, because both
 * need answers only this service holds: what the chain looks like, and which
 * branches sit above the checkout.
 *
 * - A stack-wide rewrite (`sync`, `rebase`) refuses a dirty calling worktree,
 *   because a rebase stops on one and leaves the chain half-moved.
 * - The same rewrite refuses when any branch above the current one is checked
 *   out elsewhere, most often another thread's worktree: rewriting history that
 *   a live checkout stands on either fails mid-way or leaves that thread on
 *   commits nothing references any more.
 *
 * `submit` and `merge` touch neither the working tree nor history below their
 * arguments, so they carry neither check.
 *
 * One property of the extension shapes everything below. It keeps its stack
 * tracking in a file inside the git directory of the checkout that set the
 * stack up, and every linked worktree has its own git directory. So a chain
 * one worktree knows about is invisible from the repository root and from
 * every other worktree of the same repository. Reads and actions therefore
 * search this repository's checkouts for one that can see the branch the
 * caller named, and act there.
 */

const VIEW_CACHE_TTL_SECONDS = 15;
const VIEW_CACHE_CAPACITY = 64;

/** How many trailing progress lines an action reports back. */
const ACTION_SUMMARY_LINES = 6;

const VIEW_CACHE_TTL = Duration.seconds(VIEW_CACHE_TTL_SECONDS);

export interface WorktreeCheckout {
  readonly path: string;
  /** Null for a detached head or a bare repository, neither of which names a branch. */
  readonly branch: string | null;
  /** True when git reports the directory is gone, so no command can run there. */
  readonly prunable: boolean;
}

export function parseWorktreeList(stdout: string): ReadonlyArray<WorktreeCheckout> {
  const checkouts: Array<WorktreeCheckout> = [];
  let path: string | null = null;
  let branch: string | null = null;
  let prunable = false;
  const flush = () => {
    if (path !== null) {
      checkouts.push({ path, branch, prunable });
    }
    path = null;
    branch = null;
    prunable = false;
  };
  for (const line of stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      flush();
      path = line.slice("worktree ".length).trim();
    } else if (line.startsWith("branch ")) {
      branch = line
        .slice("branch ".length)
        .trim()
        .replace(/^refs\/heads\//, "");
    } else if (line === "prunable" || line.startsWith("prunable ")) {
      prunable = true;
    }
  }
  flush();
  return checkouts;
}

/** The branches strictly above `name` in the chain — the ones a rewrite would move. */
export function branchesAbove(view: GitStackView, name: string): ReadonlyArray<GitStackBranch> {
  const index = view.branches.findIndex((branch) => branch.name === name);
  // A checkout outside the chain means every branch sits above it, so all of
  // them need guarding.
  return index === -1 ? view.branches : view.branches.slice(index + 1);
}

export class GitStackService extends Context.Service<
  GitStackService,
  {
    /**
     * The stack covering `cwd`, or null when there is none. Naming `branch`
     * asks for the chain that holds that branch: the extension tracks a stack
     * inside one checkout's git directory, so the answer often lives in a
     * worktree rather than at `cwd`, and a named branch that no chain holds
     * reads as no stack. Held for a few seconds so a sidebar of threads
     * sharing one repository costs one read, not one per row. Every successful
     * action empties the cache before re-reading.
     */
    readonly view: (input: {
      readonly cwd: string;
      readonly branch?: string | undefined;
    }) => Effect.Effect<GitStackView | null, GitStackCommandError>;

    readonly runAction: (
      input: GitStackRunActionInput,
    ) => Effect.Effect<GitStackActionResult, GitStackError>;
  }
>()("t3/git/stack/GitStackService") {}

/** The worktree checkout that holds `branch`, or null when none does. */
export function findWorktreeForBranch(
  checkouts: ReadonlyArray<WorktreeCheckout>,
  branch: string,
): string | null {
  return checkouts.find((checkout) => checkout.branch === branch)?.path ?? null;
}

/** How many checkouts one stack read asks before it gives up. */
const MAX_STACK_PROBES = 8;

/**
 * The checkouts worth asking about the stack that holds `branch`, best first.
 *
 * The checkout that holds the branch comes first, because it is the one that
 * usually answers. The rest follow in the order git lists them. A checkout git
 * calls prunable has no directory left to run in, and one with no branch cannot
 * answer at all, because the extension reports the chain of the current branch.
 * The list is capped so a repository with dozens of worktrees does not turn one
 * panel into dozens of `gh` runs.
 */
export function stackProbeOrder(
  checkouts: ReadonlyArray<WorktreeCheckout>,
  askedCwd: string,
  branch: string,
  limit: number = MAX_STACK_PROBES,
): ReadonlyArray<string> {
  const usable = checkouts.filter(
    (checkout) => !checkout.prunable && checkout.branch !== null && checkout.path !== askedCwd,
  );
  return [
    ...usable.filter((checkout) => checkout.branch === branch),
    ...usable.filter((checkout) => checkout.branch !== branch),
  ]
    .slice(0, limit)
    .map((checkout) => checkout.path);
}

/**
 * One stack, together with the checkout whose git directory tracks it. Actions
 * need the second half: a command run where the tracking is missing reports
 * that no stack covers the checkout.
 */
interface StackReading {
  readonly cwd: string;
  readonly view: GitStackView;
}

function viewHoldsBranch(view: GitStackView | null, branch: string): view is GitStackView {
  return view !== null && view.branches.some((entry) => entry.name === branch);
}

export const make = Effect.gen(function* () {
  const ghStack = yield* GhStackCli.GhStackCli;
  const process = yield* VcsProcess.VcsProcess;

  const readStack = Effect.fn("GitStackService.readStack")(function* (
    cwd: string,
    branch?: string,
  ) {
    const atCwd = yield* ghStack.view(cwd);
    if (branch === undefined) {
      return atCwd === null ? null : ({ cwd, view: atCwd } satisfies StackReading);
    }
    if (viewHoldsBranch(atCwd, branch)) {
      return { cwd, view: atCwd } satisfies StackReading;
    }
    // The caller's own checkout cannot see the branch, either because it tracks
    // no stack or because it tracks a different one. Ask this repository's other
    // checkouts, and take the first chain that holds the branch. A pull request
    // panel names the pull request's own head branch, so the answer is the chain
    // that pull request sits in.
    const checkouts = yield* worktreeCheckouts(cwd);
    for (const candidate of stackProbeOrder(checkouts, cwd, branch)) {
      // A checkout that cannot answer is not a failure of the read: the next
      // one may still hold the chain.
      const view = yield* ghStack.view(candidate).pipe(Effect.orElseSucceed(() => null));
      if (viewHoldsBranch(view, branch)) {
        return { cwd: candidate, view } satisfies StackReading;
      }
    }
    // Answering with a chain that leaves the branch out would draw the reader a
    // stack their pull request does not sit in.
    return null;
  });

  const viewCache = yield* Cache.makeWith(
    Effect.fn("GitStackService.readStack.cached")(function* (input: {
      readonly cwd: string;
      readonly branch?: string | undefined;
    }) {
      return yield* readStack(input.cwd, input.branch);
    }),
    {
      capacity: VIEW_CACHE_CAPACITY,
      timeToLive: (exit) => (exit._tag === "Success" ? VIEW_CACHE_TTL : Duration.zero),
    },
  );

  // A stack action moves branches across a whole repository, and one repository
  // is reachable through its root and through every worktree, under keys this
  // cache cannot relate to each other. So a successful action drops every entry
  // rather than pretending to know which ones it invalidated.
  const invalidate = Cache.invalidateAll(viewCache);

  /**
   * One short git read whose failure reads as "no answer". Every caller here
   * judges a missing answer the safe way on its own: an unreadable status counts
   * as dirty, and an unreadable worktree list guards nothing.
   */
  const readGitSafe = (input: {
    readonly cwd: string;
    readonly args: ReadonlyArray<string>;
  }): Effect.Effect<SafeReadOutcome, never> =>
    process
      .run({
        operation: `git-stack-service:${input.args[0] ?? "git"}`,
        command: "git",
        args: input.args,
        cwd: input.cwd,
        timeoutMs: 15_000,
      })
      .pipe(
        Effect.map((result) => ({
          exitCode: result.exitCode as number,
          stdout: result.stdout,
        })),
        Effect.orElseSucceed(() => ({ exitCode: 1, stdout: "" })),
      );

  /** True when the checkout holds staged or tracked modifications. Untracked files are fine. */
  const isDirty = (cwd: string) =>
    Effect.gen(function* () {
      const status = yield* readGitSafe({
        cwd,
        args: ["status", "--porcelain", "--untracked-files=no"],
      });
      // An unreadable status is treated as a dirty one: a refusal costs a
      // retry, while an unguarded rebase rewrites a live chain.
      return status.exitCode !== 0 || status.stdout.trim().length > 0;
    });

  /** Where every branch of this repository is checked out, by branch name. */
  const worktreeCheckouts = (cwd: string) =>
    Effect.gen(function* () {
      const listing = yield* readGitSafe({ cwd, args: ["worktree", "list", "--porcelain"] });
      return listing.exitCode === 0 ? parseWorktreeList(listing.stdout) : [];
    });

  /**
   * The remote name that push-style commands should target, following the same
   * precedence the gh-stack documentation asks for: the repository's own
   * `remote.pushDefault` first, then its single remote, then `origin`. With
   * several remotes and no default there is no honest guess, so the caller is
   * refused and told the one-line fix.
   */
  const resolvePushRemote = (cwd: string) =>
    Effect.gen(function* () {
      const configured = yield* readGitSafe({
        cwd,
        args: ["config", "--get", "remote.pushDefault"],
      });
      const configuredName = configured.exitCode === 0 ? configured.stdout.trim() : "";
      if (configuredName.length > 0) {
        return configuredName;
      }
      const remotes = yield* readGitSafe({ cwd, args: ["remote"] });
      const names = remotes.stdout
        .split("\n")
        .map((name) => name.trim())
        .filter((name) => name.length > 0);
      if (names.length === 1) {
        return names[0]!;
      }
      if (names.includes("origin")) {
        return "origin";
      }
      return yield* new GitStackCommandError({
        cwd,
        operation: "resolve-remote",
        stderrTail:
          "This repository has several remotes and no remote.pushDefault. Run `git config remote.pushDefault <name>` and retry.",
      });
    });

  const summaryFrom = (outcome: { readonly stdout: string; readonly stderr: string }) => {
    const printed = [outcome.stderr.trim(), outcome.stdout.trim()].filter(Boolean).join("\n");
    const tail = printed.split("\n").slice(-ACTION_SUMMARY_LINES).join("\n").trim();
    return tail.length > 0 ? tail : "Done.";
  };

  /**
   * One stack command with its process failures already folded into the
   * service's own error type: a missing binary or a timeout is a command
   * failure as far as the caller is concerned.
   */
  const runGh = (input: {
    readonly cwd: string;
    readonly args: ReadonlyArray<string>;
  }): Effect.Effect<GhStackCli.RawCommandOutcome, GitStackCommandError> =>
    ghStack.execRaw(input).pipe(
      Effect.mapError(
        () =>
          new GitStackCommandError({
            cwd: input.cwd,
            operation: input.args[0] ?? "gh",
            stderrTail: "The gh command could not be started.",
          }),
      ),
    );

  const notInStack = (input: GitStackRunActionInput) =>
    new GitStackCommandError({
      cwd: input.cwd,
      operation: input.action,
      stderrTail: "No GitHub stack covers this checkout.",
    });

  /**
   * Moves the caller's own checkout onto the branch of a pull request in the
   * stack.
   *
   * This one action runs where the caller asked and nowhere else: a reader
   * walking the chain from a thread wants that thread's working tree to follow.
   * It also needs no stack tracking beforehand, because `gh stack checkout`
   * reads the stack from GitHub and starts tracking it when the checkout has
   * none — which is how a thread's worktree gains tracking in the first place.
   */
  const runCheckout = Effect.fn("GitStackService.runCheckout")(function* (
    input: GitStackRunActionInput,
  ) {
    if (input.prNumber === undefined) {
      return yield* new GitStackCommandError({
        cwd: input.cwd,
        operation: "checkout",
        stderrTail: "A checkout names the pull request to switch to.",
      });
    }
    if (yield* isDirty(input.cwd)) {
      return yield* new GitStackPreflightError({ cwd: input.cwd, reason: "dirty-worktree" });
    }
    const outcome = yield* runGh({ cwd: input.cwd, args: ["checkout", String(input.prNumber)] });
    if (outcome.exitCode !== 0) {
      // Git refuses a branch that another worktree already holds, and the
      // extension passes that refusal through. Its wording names the blocking
      // directory, so the reader knows which checkout to close.
      return yield* new GitStackCommandError({
        cwd: input.cwd,
        operation: "checkout",
        exitCode: outcome.exitCode,
        stderrTail: stderrTail(outcome.stderr),
      });
    }
    yield* invalidate;
    const reading = yield* Cache.get(viewCache, { cwd: input.cwd });
    if (reading === null) {
      return yield* new GitStackCommandError({
        cwd: input.cwd,
        operation: "checkout",
        stderrTail:
          "The checkout moved, but the stack could not be read back. Refresh to see the result.",
      });
    }
    return {
      action: "checkout",
      summary: summaryFrom(outcome),
      view: reading.view,
    } satisfies GitStackActionResult;
  });

  const runAction: GitStackService["Service"]["runAction"] = (input) =>
    Effect.gen(function* () {
      if (input.action === "checkout") {
        return yield* runCheckout(input);
      }

      // Every other action runs where the stack tracking lives, which is not
      // always where the caller stands: a pull request panel acts from the
      // project's root checkout, while the tracking sits in the worktree that
      // set the stack up.
      const reading = yield* Cache.get(viewCache, {
        cwd: input.cwd,
        ...(input.branch === undefined ? {} : { branch: input.branch }),
      });
      if (reading === null) {
        return yield* notInStack(input);
      }
      const cwd = reading.cwd;
      const view = reading.view;

      const rewritesHistory = input.action === "sync" || input.action === "rebase";

      if (rewritesHistory && (yield* isDirty(cwd))) {
        return yield* new GitStackPreflightError({
          cwd,
          reason: "dirty-worktree",
        });
      }

      if (rewritesHistory) {
        const guarded =
          view.currentBranch !== null ? branchesAbove(view, view.currentBranch) : view.branches;
        const checkouts = yield* worktreeCheckouts(cwd);
        for (const branch of guarded) {
          const holder = checkouts.find((checkout) => checkout.branch === branch.name);
          if (holder !== undefined) {
            return yield* new GitStackPreflightError({
              cwd,
              reason: "branch-checked-out-elsewhere",
              blockedBranch: branch.name,
              blockedWorktreePath: holder.path,
            });
          }
        }
      }

      if (input.action === "merge") {
        if (input.prNumber === undefined) {
          return yield* new GitStackCommandError({
            cwd,
            operation: "merge",
            stderrTail: "A merge names the pull request to land.",
          });
        }
        const knownNumbers = new Set(
          view.branches.flatMap((branch) => (branch.pr ? [branch.pr.number] : [])),
        );
        if (!knownNumbers.has(input.prNumber)) {
          return yield* new GitStackCommandError({
            cwd,
            operation: "merge",
            stderrTail: `Pull request #${input.prNumber} belongs to no branch of this stack.`,
          });
        }
      }

      // `submit` and `sync` must carry a remote: without one the extension can
      // pick a different default per invocation, which is exactly what its own
      // documentation warns against.
      const outcome = yield* input.action === "submit" || input.action === "sync"
        ? Effect.flatMap(resolvePushRemote(cwd), (remote) =>
            runGh({
              cwd,
              args:
                input.action === "submit"
                  ? ["submit", "--auto", "--remote", remote]
                  : ["sync", "--remote", remote],
            }),
          )
        : input.action === "rebase"
          ? runGh({ cwd, args: ["rebase", "--upstack"] })
          : runGh({
              cwd,
              args: ["merge", String(input.prNumber), "--yes"],
            });

      if (outcome.exitCode === 3) {
        return yield* new GitStackConflictError({ cwd, operation: input.action });
      }
      if (outcome.exitCode !== 0) {
        return yield* new GitStackCommandError({
          cwd,
          operation: input.action,
          exitCode: outcome.exitCode,
          stderrTail: stderrTail(outcome.stderr),
        });
      }

      yield* invalidate;
      const nextReading = yield* Cache.get(viewCache, { cwd });
      if (nextReading === null) {
        return yield* new GitStackCommandError({
          cwd,
          operation: input.action,
          stderrTail:
            "The action ran, but the stack could not be read back. Refresh to see the result.",
        });
      }
      return {
        action: input.action,
        summary: summaryFrom(outcome),
        view: nextReading.view,
      } satisfies GitStackActionResult;
    });

  return {
    view: (input: { readonly cwd: string; readonly branch?: string | undefined }) =>
      Cache.get(viewCache, input).pipe(Effect.map((reading) => reading?.view ?? null)),
    runAction,
  };
});

export const layer = Layer.effect(GitStackService, make);

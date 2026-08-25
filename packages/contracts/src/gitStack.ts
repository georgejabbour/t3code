import * as Schema from "effect/Schema";

import { PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * GitHub stacked pull requests, read through the `gh stack` extension
 * (https://github.com/github/gh-stack). Added by this fork. See Patch 16 in
 * PATCHES.md.
 *
 * A stack is an ordered chain of branches rooted on a trunk, where each branch
 * has one pull request based on the branch below it. The chain is written
 * trunk-first: the first branch merges first, the last one merges last.
 */

const StackPullRequestState = Schema.Literals(["open", "merged", "queued"]);

const StackPullRequest = Schema.Struct({
  number: PositiveInt,
  url: Schema.String,
  state: StackPullRequestState,
});

export const GitStackBranch = Schema.Struct({
  name: TrimmedNonEmptyString,
  /** The branch tip the last read saw. Informational only; do not compare against a live ref. */
  head: Schema.String,
  /**
   * The saved commit of this branch's parent that the extension last knew this
   * branch to contain. Older than the parent's current tip when `needsRebase`
   * is true.
   */
  base: Schema.String,
  isCurrent: Schema.Boolean,
  isMerged: Schema.Boolean,
  isQueued: Schema.Boolean,
  /** True when the parent branch's tip has moved past what this branch contains. */
  needsRebase: Schema.Boolean,
  pr: Schema.NullOr(StackPullRequest),
});
export type GitStackBranch = typeof GitStackBranch.Type;

/**
 * One whole stack, ordered trunk-first: `branches[0]` sits at the bottom and
 * merges first, the last entry sits at the top. `currentBranch` is null when
 * the checkout sits on a branch outside the chain, for example on the trunk
 * itself.
 */
export const GitStackView = Schema.Struct({
  trunk: TrimmedNonEmptyString,
  currentBranch: Schema.NullOr(TrimmedNonEmptyString),
  branches: Schema.Array(GitStackBranch).check(Schema.isMinLength(1)),
});
export type GitStackView = typeof GitStackView.Type;

/**
 * The actions T3 Code runs from the interface. Each one maps onto exactly one
 * non-interactive `gh stack` invocation:
 *
 * - `submit`    -> `gh stack submit --auto --remote <remote>`: push every branch
 *                  and open or refresh its draft pull request.
 * - `sync`      -> `gh stack sync --remote <remote>`: fetch, rebase the whole
 *                  chain onto its parents, push, and refresh pull requests.
 * - `rebase`    -> `gh stack rebase --upstack`: replay every branch above the
 *                  current one onto the change just made below it.
 * - `merge`     -> `gh stack merge <pr> --yes`: merge the named pull request
 *                  plus every unmerged pull request below it, all-or-nothing.
 * - `checkout`  -> `gh stack checkout <pr>`: move the calling checkout onto the
 *                  branch of the named pull request. When that checkout tracks
 *                  no stack yet, the extension reads the stack from GitHub and
 *                  starts tracking it there.
 */
export const GitStackActionKind = Schema.Literals([
  "submit",
  "sync",
  "rebase",
  "merge",
  "checkout",
]);
export type GitStackActionKind = typeof GitStackActionKind.Type;

export const GitStackRunActionInput = Schema.Struct({
  /**
   * The checkout the caller acts from. `checkout` always runs here, because
   * moving this working tree is the whole point of it. Every other action runs
   * in the checkout that can read the stack, which `branch` helps to find.
   */
  cwd: TrimmedNonEmptyString,
  action: GitStackActionKind,
  /** Required by `merge` and by `checkout`, refused by every other action. */
  prNumber: Schema.optional(PositiveInt),
  /**
   * The branch whose stack the action belongs to. The `gh stack` extension
   * keeps its stack tracking inside one checkout's git directory, so a chain
   * can be invisible from `cwd`; naming the branch lets the server find the
   * checkout that does see it. Ignored by `checkout`.
   */
  branch: Schema.optional(TrimmedNonEmptyString),
});
export type GitStackRunActionInput = typeof GitStackRunActionInput.Type;

export const GitStackActionResult = Schema.Struct({
  action: GitStackActionKind,
  /** The last lines the command printed, for a toast or an activity note. */
  summary: TrimmedNonEmptyString,
  /** The stack read again after the action, so the interface can redraw at once. */
  view: GitStackView,
});
export type GitStackActionResult = typeof GitStackActionResult.Type;

/**
 * A safety check refused before any command ran. The refusal names the branch
 * and the checkout that blocks it, because a message without those two names
 * sends the reader hunting through worktrees by hand.
 */
export class GitStackPreflightError extends Schema.TaggedErrorClass<GitStackPreflightError>()(
  "GitStackPreflightError",
  {
    cwd: TrimmedNonEmptyString,
    reason: Schema.Literals(["dirty-worktree", "branch-checked-out-elsewhere"]),
    blockedBranch: Schema.optional(TrimmedNonEmptyString),
    blockedWorktreePath: Schema.optional(TrimmedNonEmptyString),
  },
) {
  override get message(): string {
    if (this.reason === "dirty-worktree") {
      return `The checkout at ${this.cwd} holds uncommitted changes. Commit or stash them before running a stack action.`;
    }
    const where = this.blockedWorktreePath ?? "another checkout";
    return `${this.blockedBranch ?? "A branch above the current one"} is checked out at ${where}. Rebase history would move under it. Close that thread's checkout first.`;
  }
}

/**
 * The stack rebase stopped on a merge conflict (the extension's exit code 3).
 * The branches are left half-rebased on disk, so the recovery commands are part
 * of the answer rather than an aside.
 */
export class GitStackConflictError extends Schema.TaggedErrorClass<GitStackConflictError>()(
  "GitStackConflictError",
  {
    cwd: TrimmedNonEmptyString,
    operation: TrimmedNonEmptyString,
  },
) {
  override get message(): string {
    return [
      `The stack rebase stopped on a conflict in ${this.operation}.`,
      "Resolve the conflict markers, run `git add`, then `gh stack rebase --continue`.",
      "To give up instead, run `gh stack rebase --abort`.",
    ].join(" ");
  }
}

/** Any other `gh stack` failure, carrying what the command printed. */
export class GitStackCommandError extends Schema.TaggedErrorClass<GitStackCommandError>()(
  "GitStackCommandError",
  {
    cwd: TrimmedNonEmptyString,
    operation: TrimmedNonEmptyString,
    exitCode: Schema.optional(Schema.Int),
    stderrTail: Schema.optional(Schema.String),
  },
) {
  override get message(): string {
    const printed =
      this.stderrTail !== undefined && this.stderrTail.length > 0 ? `: ${this.stderrTail}` : "";
    return `gh stack ${this.operation} failed${printed}`;
  }
}

export const GitStackError = Schema.Union([
  GitStackPreflightError,
  GitStackConflictError,
  GitStackCommandError,
]);
export type GitStackError = typeof GitStackError.Type;

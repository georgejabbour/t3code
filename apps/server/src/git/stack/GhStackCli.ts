import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { GitStackCommandError, GitStackView, type VcsError } from "@t3tools/contracts";

import * as VcsProcess from "../../vcs/VcsProcess.ts";

/**
 * Runs the `gh stack` extension commands and reads their answers. Added by this
 * fork. See Patch 16 in PATCHES.md.
 *
 * Every invocation is non-interactive by construction: the commands this module
 * runs are exactly the ones the gh-stack documentation lists as safe when
 * stdout is not a terminal, and each carries the flags that silence its
 * prompts. Nothing here can open the extension's full-screen interface and
 * block the server.
 */

const GH_STACK_VIEW_TIMEOUT_MS = 60_000;
/** A sync rebases and pushes every branch in the chain, which regularly outlasts a minute. */
export const GH_STACK_ACTION_TIMEOUT_MS = 10 * 60_000;

/** How many trailing lines of a failed command's output travel back to the client. */
const STDERR_TAIL_LINES = 12;

export function stderrTail(stderr: string): string {
  const lines = stderr.trimEnd().split("\n");
  return lines.slice(-STDERR_TAIL_LINES).join("\n").trim();
}

const RawStackPullRequest = Schema.Struct({
  number: Schema.Number,
  url: Schema.String,
  /** The extension spells these upper-case; the contract spells them lower-case. */
  state: Schema.Literals(["OPEN", "MERGED", "QUEUED"]),
});

const RawStackBranch = Schema.Struct({
  name: Schema.String,
  head: Schema.String,
  base: Schema.String,
  isCurrent: Schema.Boolean,
  isMerged: Schema.Boolean,
  isQueued: Schema.Boolean,
  needsRebase: Schema.Boolean,
  /** Absent when the branch has no pull request yet. */
  pr: Schema.optional(Schema.NullOr(RawStackPullRequest)),
});

const RawStackView = Schema.Struct({
  trunk: Schema.String,
  currentBranch: Schema.NullOr(Schema.String),
  branches: Schema.Array(RawStackBranch),
});

type RawStackView = typeof RawStackView.Type;

/**
 * Turns one decoded `gh stack view --json` answer into the contract shape.
 * Kept pure so the tests can feed it captured output without a process runner.
 *
 * The extension writes `pr.state` upper-case and leaves the whole `pr` field
 * out when a branch has no pull request; the contract wants lower-case states
 * and an explicit null. A checkout sitting on the trunk is not sitting on a
 * chain branch, so its `currentBranch` reads as null, which is what the
 * contract's "no chain branch is current" means.
 */
export function normalizeStackView(rawView: RawStackView): GitStackView {
  const currentBranch =
    rawView.currentBranch === null || rawView.currentBranch === rawView.trunk
      ? null
      : rawView.currentBranch;
  return {
    trunk: rawView.trunk,
    currentBranch,
    branches: rawView.branches.map((branch) => ({
      name: branch.name,
      head: branch.head,
      base: branch.base,
      isCurrent: branch.isCurrent,
      isMerged: branch.isMerged,
      isQueued: branch.isQueued,
      needsRebase: branch.needsRebase,
      pr:
        branch.pr == null
          ? null
          : {
              number: branch.pr.number,
              url: branch.pr.url,
              state: branch.pr.state.toLowerCase() as "open" | "merged" | "queued",
            },
    })),
  };
}

// The normalized answer is read back through the published contract, so a drift
// between this parser and the schema the client trusts fails here instead of on
// the wire.
const decodeRawStackView = Schema.decodeEffect(Schema.fromJsonString(RawStackView));
const decodeContractView = Schema.decodeUnknownEffect(GitStackView);

export interface RawCommandOutcome {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export class GhStackCli extends Context.Service<
  GhStackCli,
  {
    /**
     * The stack the checkout belongs to, or null when it belongs to none. A read
     * failure other than exit code 2 fails the caller — a half-read chain must
     * never reach the interface dressed up as a whole one.
     */
    readonly view: (cwd: string) => Effect.Effect<GitStackView | null, GitStackCommandError>;

    /**
     * One non-interactive stack command, with its exit code and both streams
     * intact. Non-zero exits are outcomes here, not failures: the extension uses
     * exit codes as its own protocol (2 for "not in a stack", 3 for a rebase
     * conflict), and only the caller knows which code means what.
     */
    readonly execRaw: (input: {
      readonly cwd: string;
      readonly args: ReadonlyArray<string>;
      readonly timeoutMs?: number;
    }) => Effect.Effect<RawCommandOutcome, VcsError>;
  }
>()("t3/git/stack/GhStackCli") {}

export const make = Effect.gen(function* () {
  const process = yield* VcsProcess.VcsProcess;

  const execRaw: GhStackCli["Service"]["execRaw"] = (input) =>
    process
      .run({
        operation: `gh-stack:${input.args.join("-")}`,
        command: "gh",
        args: ["stack", ...input.args],
        cwd: input.cwd,
        timeoutMs: input.timeoutMs ?? GH_STACK_ACTION_TIMEOUT_MS,
        allowNonZeroExit: true,
      })
      .pipe(
        Effect.map((result) => ({
          exitCode: result.exitCode as number,
          stdout: result.stdout,
          stderr: result.stderr,
        })),
      );

  const view: GhStackCli["Service"]["view"] = (cwd) =>
    Effect.gen(function* () {
      const outcome = yield* execRaw({
        cwd,
        args: ["view", "--json"],
        timeoutMs: GH_STACK_VIEW_TIMEOUT_MS,
      });
      if (outcome.exitCode === 2) {
        return null;
      }
      if (outcome.exitCode !== 0) {
        return yield* new GitStackCommandError({
          cwd,
          operation: "view",
          exitCode: outcome.exitCode,
          stderrTail: stderrTail(outcome.stderr),
        });
      }
      const rawView = yield* decodeRawStackView(outcome.stdout.trim());
      return yield* decodeContractView(normalizeStackView(rawView));
    }).pipe(
      // A decode failure reads as its own answer; an exit failure already
      // carries its own GitStackCommandError and passes through untouched.
      Effect.catch((error) => {
        if (
          typeof error === "object" &&
          error !== null &&
          "_tag" in error &&
          error._tag === "GitStackCommandError"
        ) {
          return Effect.fail(error as GitStackCommandError);
        }
        return Effect.fail(
          new GitStackCommandError({
            cwd,
            operation: "view",
            stderrTail: "The answer was not a stack description this reader could decode.",
          }),
        );
      }),
    );

  return { view, execRaw };
});

export const layer = Layer.effect(GhStackCli, make);

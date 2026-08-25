import type {
  EnvironmentId,
  GitStackBranch,
  GitStackView,
  PullRequestRef,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { GitBranchIcon, GitPullRequestIcon, LayersIcon } from "lucide-react";
import { useState, type MouseEvent as ReactMouseEvent } from "react";

import { useGitStack, useGitStackAction } from "~/state/gitStacks";
import { useOpenPrLink } from "~/lib/openPullRequestLink";
import { useRightPanelStore } from "~/rightPanelStore";
import { cn } from "~/lib/utils";
import { toastManager } from "../ui/toast";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";

// Added by this fork. The GitHub stack chain and its actions; see Patch 16 in
// PATCHES.md.

function prStateClass(branch: GitStackBranch): string {
  if (!branch.pr) return "text-muted-foreground/40";
  switch (branch.pr.state) {
    case "open":
      return "text-emerald-600 dark:text-emerald-300/90";
    case "merged":
      return "text-violet-600 dark:text-violet-300/90";
    case "queued":
      return "text-blue-600 dark:text-blue-300/90";
  }
}

/**
 * The pull requests that a merge of `prNumber` would land: that one plus every
 * still-open pull request below it in the chain. The extension merges the whole
 * set or nothing, so the dialog names the whole set.
 */
export function stackMergeSet(
  view: GitStackView,
  prNumber: number,
): ReadonlyArray<{ branch: GitStackBranch; number: number }> {
  const index = view.branches.findIndex((branch) => branch.pr?.number === prNumber);
  if (index === -1) return [];
  const landed: Array<{ branch: GitStackBranch; number: number }> = [];
  for (const branch of view.branches.slice(0, index + 1)) {
    if (branch.pr && branch.pr.state !== "merged") {
      landed.push({ branch, number: branch.pr.number });
    }
  }
  return landed.toReversed();
}

const ACTION_LABELS = {
  submit: "Submit stack",
  sync: "Sync stack",
  rebase: "Rebase upstack",
} as const;

export function GitStackChainCard({
  environmentId,
  cwd,
  branchName,
  branch,
  reference,
  threadRef,
  threadCwd,
  mergePrNumber = null,
}: {
  environmentId: EnvironmentId;
  /** The repository checkout the stack lives in. */
  cwd: string;
  /** The branch to mark as "you are here"; usually the thread's or the PR's head branch. */
  branchName?: string | null;
  /**
   * The branch whose chain to read and act on — the pull request's head branch.
   * A stack is tracked inside one checkout, often a worktree rather than `cwd`,
   * so the server uses this name to find the checkout that can see the chain.
   */
  branch?: string | null;
  /**
   * The pull request reference whose repository the chain members belong to.
   * Every branch of a stack shares one repository.
   */
  reference?: PullRequestRef | undefined;
  /** The thread beside which this card is open, when there is one. */
  threadRef?: ScopedThreadRef | undefined;
  /** The thread's own worktree, which a row click moves onto the clicked branch. */
  threadCwd?: string | null | undefined;
  /** When set, offers to merge this pull request plus every open one below it. */
  mergePrNumber?: number | null;
}) {
  const { view, refresh } = useGitStack({
    environmentId,
    cwd,
    ...(branch ? { branch } : {}),
  });
  if (!view) return null;
  return (
    <ChainCardInner
      view={view}
      environmentId={environmentId}
      cwd={cwd}
      branch={branch ?? null}
      branchName={branchName ?? null}
      mergePrNumber={mergePrNumber}
      reference={reference ?? null}
      threadRef={threadRef ?? null}
      threadCwd={threadCwd ?? null}
      onRefresh={refresh}
    />
  );
}

function ChainCardInner({
  view,
  environmentId,
  cwd,
  branch,
  branchName,
  mergePrNumber,
  reference,
  threadRef,
  threadCwd,
  onRefresh,
}: {
  view: GitStackView;
  environmentId: EnvironmentId;
  cwd: string;
  branch: string | null;
  branchName: string | null;
  mergePrNumber: number | null;
  reference: PullRequestRef | null;
  threadRef: ScopedThreadRef | null;
  threadCwd: string | null;
  onRefresh: () => void;
}) {
  const { run } = useGitStackAction(environmentId);
  const openPrLink = useOpenPrLink();
  const [running, setRunning] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  /**
   * What a chain row does. With a thread beside the panel: move the thread's own
   * worktree onto that pull request's branch, then open its panel here — the
   * reader walks the stack and the thread follows. Cmd/ctrl+click still opens
   * GitHub. Without a thread there is no working tree to move, so the row falls
   * back to the pull request surface's own navigation.
   */
  const traverse = async (
    event: ReactMouseEvent<HTMLElement, MouseEvent>,
    pr: { number: number; url: string },
  ) => {
    if (event.metaKey || event.ctrlKey) {
      window.open(pr.url, "_blank");
      return;
    }
    if (threadRef === null || threadCwd === null || reference === null) {
      openPrLink(event, pr.url);
      return;
    }
    event.preventDefault();
    if (running !== null) return;
    setRunning(`checkout-${pr.number}`);
    // The thread's own worktree, not the checkout the chain was read from: this
    // is the one working tree the reader wants to follow the stack.
    const outcome = await run({ action: "checkout", cwd: threadCwd, prNumber: pr.number });
    setRunning(null);
    if (!outcome.ok) {
      toastManager.add({
        type: "error",
        title: `Could not check out #${pr.number}`,
        description: outcome.message ?? undefined,
      });
      return;
    }
    onRefresh();
    useRightPanelStore.getState().openPullRequest(threadRef, {
      projectId: reference.projectId,
      repository: reference.repository,
      number: pr.number,
    });
  };

  const execute = async (action: "submit" | "sync" | "rebase" | "merge", prNumber?: number) => {
    if (running !== null) return;
    setRunning(action);
    const outcome = await run({
      action,
      cwd,
      // The chain can be tracked in a worktree rather than at `cwd`, so the
      // server needs the branch to find the checkout that can run the command.
      ...(branch ? { branch } : {}),
      ...(action === "merge" && prNumber !== undefined ? { prNumber } : {}),
    });
    setRunning(null);
    if (!outcome.ok) {
      toastManager.add({
        type: "error",
        title: "Stack action failed",
        description: outcome.message ?? undefined,
      });
      return;
    }
    onRefresh();
    toastManager.add({
      type: "success",
      title: "Stack updated",
      description: outcome.summary ?? undefined,
    });
  };

  const mergeTargets = mergePrNumber !== null ? stackMergeSet(view, mergePrNumber) : [];
  const canMerge = mergeTargets.length > 0;

  return (
    <section
      data-testid="git-stack-chain-card"
      className="border-border/60 rounded-lg border p-3"
      aria-label="GitHub stack"
    >
      <header className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
        <LayersIcon className="size-3.5" />
        <span>Stack</span>
        <span className="text-muted-foreground/60">
          {view.branches.length} {view.branches.length === 1 ? "branch" : "branches"}
        </span>
      </header>
      <ol className="mt-2 space-y-1">
        {view.branches.toReversed().map((branch, reversedIndex) => {
          const position = view.branches.length - reversedIndex;
          const isHere = branch.name === branchName || branch.isCurrent;
          const row = (
            <>
              <span className="text-muted-foreground/60 w-6 shrink-0 text-right text-xs tabular-nums">
                {position}
              </span>
              {branch.pr ? (
                <GitPullRequestIcon className={cn("size-3.5 shrink-0", prStateClass(branch))} />
              ) : (
                <GitBranchIcon className="text-muted-foreground/50 size-3.5 shrink-0" />
              )}
              <span className={cn("truncate", isHere && "font-medium")}>{branch.name}</span>
              {branch.pr ? (
                <span className="text-muted-foreground/60 shrink-0 text-xs tabular-nums">
                  #{branch.pr.number}
                </span>
              ) : null}
              {isHere ? (
                <span className="text-muted-foreground/60 shrink-0 text-[10px] uppercase">
                  here
                </span>
              ) : null}
              {branch.needsRebase ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span className="shrink-0 text-[10px] text-amber-600 dark:text-amber-300/90" />
                    }
                  >
                    needs rebase
                  </TooltipTrigger>
                  <TooltipPopup>
                    The branch below has moved. Sync the stack to replay this one onto it.
                  </TooltipPopup>
                </Tooltip>
              ) : null}
            </>
          );
          // A branch with a pull request traverses: plain click opens it in
          // the pull request surface, cmd/ctrl+click opens GitHub. Branches
          // without one are rows of the chain, not links.
          return (
            <li key={branch.name} className="text-sm">
              {branch.pr ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        disabled={running !== null}
                        onClick={(event) => void traverse(event, branch.pr!)}
                        className="hover:bg-accent/60 -mx-1 flex w-[calc(100%+0.5rem)] items-center gap-2 rounded px-1 py-0.5 text-left disabled:opacity-60"
                      />
                    }
                  >
                    {row}
                  </TooltipTrigger>
                  <TooltipPopup>
                    Check out {branch.name} here and open pull request #{branch.pr.number}
                  </TooltipPopup>
                </Tooltip>
              ) : (
                <span className="flex items-center gap-2 px-1 py-0.5">{row}</span>
              )}
            </li>
          );
        })}
      </ol>
      <footer className="mt-3 flex flex-wrap items-center gap-2">
        {(Object.keys(ACTION_LABELS) as Array<keyof typeof ACTION_LABELS>).map((action) => (
          <Button
            key={action}
            variant="outline"
            size="sm"
            disabled={running !== null}
            onClick={() => void execute(action)}
          >
            {running === action ? "Running…" : ACTION_LABELS[action]}
          </Button>
        ))}
        {canMerge && mergePrNumber !== null ? (
          <Button
            variant="default"
            size="sm"
            disabled={running !== null}
            onClick={() => setConfirmOpen(true)}
          >
            Merge…
          </Button>
        ) : null}
      </footer>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogBackdrop />
        <AlertDialogPopup>
          <AlertDialogTitle>Merge this stack?</AlertDialogTitle>
          <AlertDialogDescription>
            Merging lands these pull requests together, bottom first, all-or-nothing:
          </AlertDialogDescription>
          <ul className="mt-2 space-y-1 text-sm">
            {mergeTargets.map(({ branch, number }) => (
              <li key={number} className="flex items-center gap-2">
                <span className="text-muted-foreground tabular-nums">#{number}</span>
                <span className="truncate">{branch.name}</span>
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogClose>Cancel</AlertDialogClose>
            <Button
              onClick={() => {
                setConfirmOpen(false);
                if (mergePrNumber !== null) void execute("merge", mergePrNumber);
              }}
            >
              Merge {mergeTargets.length}{" "}
              {mergeTargets.length === 1 ? "pull request" : "pull requests"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </section>
  );
}

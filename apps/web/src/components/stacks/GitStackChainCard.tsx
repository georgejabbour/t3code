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

function prStateClass(member: GitStackBranch): string {
  if (!member.pr) return "text-muted-foreground/40";
  switch (member.pr.state) {
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
  const index = view.branches.findIndex((member) => member.pr?.number === prNumber);
  if (index === -1) return [];
  const landed: Array<{ branch: GitStackBranch; number: number }> = [];
  for (const member of view.branches.slice(0, index + 1)) {
    if (member.pr && member.pr.state !== "merged") {
      landed.push({ branch: member, number: member.pr.number });
    }
  }
  return landed.toReversed();
}

const ACTION_LABELS = {
  submit: "Submit stack",
  sync: "Sync stack",
  rebase: "Rebase upstack",
} as const;

/** What a click on a chain row does. */
export type ChainRowAction = "checkout-and-open" | "open";

/**
 * What a click on a chain row does, and everything that click needs.
 *
 * Beside a thread the row moves that thread's own working tree onto the branch
 * and opens its pull request here, which is how a reader walks the chain and
 * takes their work with them. On the pull requests page there is no thread, so
 * there is no working tree to move and the row only opens the pull request.
 *
 * One function answers for both the tooltip and the click, and the answer
 * carries the three values a checkout needs. So the card cannot promise a
 * checkout down one path and take the other.
 */
export type ChainRowPlan =
  | {
      readonly action: "checkout-and-open";
      readonly threadRef: ScopedThreadRef;
      readonly threadCwd: string;
      readonly reference: PullRequestRef;
    }
  | { readonly action: "open" };

export function chainRowPlan(input: {
  readonly threadRef: ScopedThreadRef | null;
  readonly threadCwd: string | null;
  readonly reference: PullRequestRef | null;
}): ChainRowPlan {
  const { threadRef, threadCwd, reference } = input;
  if (threadRef === null || threadCwd === null || reference === null) {
    return { action: "open" };
  }
  return { action: "checkout-and-open", threadRef, threadCwd, reference };
}

/** The row's tooltip. It says what the click does, and nothing the click does not do. */
export function chainRowTooltip(
  action: ChainRowAction,
  branchName: string,
  prNumber: number,
): string {
  return action === "checkout-and-open"
    ? `Check out ${branchName} here and open pull request #${prNumber}`
    : `Open pull request #${prNumber}`;
}

export function GitStackChainCard({
  environmentId,
  cwd,
  threadBranch,
  viewingBranch,
  branch,
  reference,
  threadRef,
  threadCwd,
  mergePrNumber = null,
}: {
  environmentId: EnvironmentId;
  /** The repository checkout the stack lives in. */
  cwd: string;
  /**
   * The branch the reader's own working tree sits on, which is the thread's
   * worktree when this card is open beside a thread. Null on a surface that
   * speaks for no working tree, such as the pull requests page, and then no row
   * is marked "here" at all.
   */
  threadBranch?: string | null | undefined;
  /** The branch of the pull request this panel is showing. */
  viewingBranch?: string | null | undefined;
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
  threadRef?: ScopedThreadRef | null | undefined;
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
      threadBranch={threadBranch ?? null}
      viewingBranch={viewingBranch ?? null}
      mergePrNumber={mergePrNumber}
      reference={reference ?? null}
      threadRef={threadRef ?? null}
      threadCwd={threadCwd ?? null}
      onRefresh={refresh}
    />
  );
}

/**
 * The chain itself, drawn top branch first. Two marks can fall on a row and they
 * say different things: "here" says the reader's own working tree sits on that
 * branch, and the bold name says this panel is showing that branch's pull
 * request. The same branch carries both while a reader reads the pull request
 * they are standing on, and they part the moment the reader opens another one.
 *
 * Both marks are handed in. Neither can be read off the stack answer, because
 * `GitStackBranch.isCurrent` describes whichever checkout answered the read: the
 * server searches the repository's worktrees for one that can see the chain, so
 * that flag regularly names a branch in a worktree the reader has never opened.
 */
export function StackChainRows({
  view,
  threadBranch,
  viewingBranch,
  rowAction,
  disabled,
  onSelect,
}: {
  view: GitStackView;
  threadBranch: string | null;
  viewingBranch: string | null;
  rowAction: ChainRowAction;
  disabled: boolean;
  onSelect: (
    event: ReactMouseEvent<HTMLElement, MouseEvent>,
    pr: { number: number; url: string },
  ) => void;
}) {
  return (
    <ol className="mt-2 space-y-1">
      {view.branches.toReversed().map((member, reversedIndex) => {
        const position = view.branches.length - reversedIndex;
        const isHere = threadBranch !== null && member.name === threadBranch;
        const isViewing = viewingBranch !== null && member.name === viewingBranch;
        const pr = member.pr;
        const row = (
          <>
            <span className="text-muted-foreground/60 w-6 shrink-0 text-right text-xs tabular-nums">
              {position}
            </span>
            {pr ? (
              <GitPullRequestIcon className={cn("size-3.5 shrink-0", prStateClass(member))} />
            ) : (
              <GitBranchIcon className="text-muted-foreground/50 size-3.5 shrink-0" />
            )}
            <span className={cn("truncate", (isHere || isViewing) && "font-medium")}>
              {member.name}
            </span>
            {pr ? (
              <span className="text-muted-foreground/60 shrink-0 text-xs tabular-nums">
                #{pr.number}
              </span>
            ) : null}
            {isHere ? (
              <span
                data-testid="git-stack-chain-here"
                className="text-muted-foreground/60 shrink-0 text-[10px] uppercase"
              >
                here
              </span>
            ) : null}
            {member.needsRebase ? (
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
        // A branch with a pull request is clickable: it either moves the thread
        // onto that branch and opens the pull request, or just opens the pull
        // request, and the tooltip says which. Cmd/ctrl+click opens GitHub.
        // Branches without one are rows of the chain, not links.
        return (
          <li key={member.name} className="text-sm">
            {pr ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      data-testid={`git-stack-chain-row-${member.name}`}
                      aria-current={isViewing ? true : undefined}
                      disabled={disabled}
                      onClick={(event) => onSelect(event, pr)}
                      className="hover:bg-accent/60 -mx-1 flex w-[calc(100%+0.5rem)] items-center gap-2 rounded px-1 py-0.5 text-left disabled:opacity-60"
                    />
                  }
                >
                  {row}
                </TooltipTrigger>
                <TooltipPopup>{chainRowTooltip(rowAction, member.name, pr.number)}</TooltipPopup>
              </Tooltip>
            ) : (
              <span
                data-testid={`git-stack-chain-row-${member.name}`}
                className="flex items-center gap-2 px-1 py-0.5"
              >
                {row}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function ChainCardInner({
  view,
  environmentId,
  cwd,
  branch,
  threadBranch,
  viewingBranch,
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
  threadBranch: string | null;
  viewingBranch: string | null;
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
  const plan = chainRowPlan({ threadRef, threadCwd, reference });

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
    if (plan.action === "open") {
      openPrLink(event, pr.url);
      return;
    }
    event.preventDefault();
    if (running !== null) return;
    setRunning(`checkout-${pr.number}`);
    // The thread's own worktree, not the checkout the chain was read from: this
    // is the one working tree the reader wants to follow the stack.
    const outcome = await run({ action: "checkout", cwd: plan.threadCwd, prNumber: pr.number });
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
    useRightPanelStore.getState().openPullRequest(plan.threadRef, {
      projectId: plan.reference.projectId,
      repository: plan.reference.repository,
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
      <StackChainRows
        view={view}
        threadBranch={threadBranch}
        viewingBranch={viewingBranch}
        rowAction={plan.action}
        disabled={running !== null}
        onSelect={(event, pr) => void traverse(event, pr)}
      />
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
            {mergeTargets.map(({ branch: member, number }) => (
              <li key={number} className="flex items-center gap-2">
                <span className="text-muted-foreground tabular-nums">#{number}</span>
                <span className="truncate">{member.name}</span>
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

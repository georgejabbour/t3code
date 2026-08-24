import type { EnvironmentId, GitStackBranch, GitStackView } from "@t3tools/contracts";
import { GitBranchIcon, GitPullRequestIcon, LayersIcon } from "lucide-react";
import { useState } from "react";

import { useGitStack, useGitStackAction } from "~/state/gitStacks";
import { cn } from "~/lib/utils";
import { toastManager } from "../ui/toast";
import { Button } from "../ui/button";
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
  return landed.reverse();
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
  mergePrNumber = null,
}: {
  environmentId: EnvironmentId;
  /** The repository checkout the stack lives in. */
  cwd: string;
  /** The branch to mark as "you are here"; usually the thread's or the PR's head branch. */
  branchName?: string | null;
  /** When set, offers to merge this pull request plus every open one below it. */
  mergePrNumber?: number | null;
}) {
  const { view } = useGitStack({ environmentId, cwd });
  if (!view) return null;
  return (
    <ChainCardInner
      view={view}
      environmentId={environmentId}
      cwd={cwd}
      branchName={branchName ?? null}
      mergePrNumber={mergePrNumber}
    />
  );
}

function ChainCardInner({
  view,
  environmentId,
  cwd,
  branchName,
  mergePrNumber,
}: {
  view: GitStackView;
  environmentId: EnvironmentId;
  cwd: string;
  branchName: string | null;
  mergePrNumber: number | null;
}) {
  const { run } = useGitStackAction(environmentId);
  const [running, setRunning] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const execute = async (action: "submit" | "sync" | "rebase" | "merge", prNumber?: number) => {
    if (running !== null) return;
    setRunning(action);
    const outcome = await run({
      action,
      cwd,
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
        {[...view.branches].reverse().map((branch, reversedIndex) => {
          const position = view.branches.length - reversedIndex;
          const isHere = branch.name === branchName || branch.isCurrent;
          return (
            <li key={branch.name} className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground/60 w-6 shrink-0 text-right text-xs tabular-nums">
                {position}
              </span>
              {branch.pr ? (
                <GitPullRequestIcon className={cn("size-3.5 shrink-0", prStateClass(branch))} />
              ) : (
                <GitBranchIcon className="text-muted-foreground/50 size-3.5 shrink-0" />
              )}
              <span className={cn("truncate", isHere && "font-medium")}>{branch.name}</span>
              {isHere ? (
                <span className="text-muted-foreground/60 shrink-0 text-[10px] uppercase">
                  here
                </span>
              ) : null}
              {branch.needsRebase ? (
                <span
                  className="shrink-0 text-[10px] text-amber-600 dark:text-amber-300/90"
                  title="The branch below has moved; sync to replay this one onto it"
                >
                  needs rebase
                </span>
              ) : null}
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

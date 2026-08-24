import type { EnvironmentId } from "@t3tools/contracts";
import { LayersIcon } from "lucide-react";
import { useState } from "react";

import { useGitStack, useGitStackAction } from "~/state/gitStacks";
import { toastManager } from "../ui/toast";
import { MenuItem, MenuSeparator } from "~/components/ui/menu";

// Added by this fork. Stack commands in the git actions menu; see Patch 16 in
// PATCHES.md.

const ITEMS = [
  { action: "submit", label: "Submit stack", hint: "Push every branch and open its pull requests" },
  { action: "sync", label: "Sync stack", hint: "Rebase the chain onto trunk and push" },
  {
    action: "rebase",
    label: "Rebase upstack",
    hint: "Replay every branch above this one onto the change just made",
  },
] as const;

/**
 * The three non-destructive stack commands as menu rows. Renders nothing when
 * the checkout belongs to no GitHub stack, so the menu looks unchanged for
 * every repository that does not use one. Merge lives on the pull request's
 * own panel, where the set that would land can be named before it does.
 */
export function GitStackMenuItems({
  environmentId,
  cwd,
}: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
}) {
  const target = environmentId !== null && cwd !== null ? { environmentId, cwd } : null;
  const { view } = useGitStack(target);
  const [running, setRunning] = useState<string | null>(null);
  const { run } = useGitStackAction(environmentId ?? ("" as EnvironmentId));

  if (!view || environmentId === null || cwd === null) {
    return null;
  }

  const execute = async (action: "submit" | "sync" | "rebase") => {
    if (running !== null) return;
    setRunning(action);
    const outcome = await run({ action, cwd });
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

  return (
    <>
      <MenuSeparator />
      <div className="text-muted-foreground/60 flex items-center gap-1.5 px-2 py-1 text-xs">
        <LayersIcon className="size-3" />
        <span>
          GitHub stack · {view.branches.length} {view.branches.length === 1 ? "branch" : "branches"}
        </span>
      </div>
      {ITEMS.map((item) => (
        <MenuItem
          key={item.action}
          disabled={running !== null}
          onClick={() => void execute(item.action)}
        >
          <LayersIcon className="size-4 opacity-0" aria-hidden="true" />
          {running === item.action ? "Running…" : item.label}
        </MenuItem>
      ))}
    </>
  );
}

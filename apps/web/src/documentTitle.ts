import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { backgroundWorkHoldsCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import {
  hasUnseenCompletion,
  resolveSidebarThreadStatus,
  resolveThreadLastVisitedAt,
} from "./components/Sidebar.logic";
import { isLatestRunSettled } from "./session-logic";
import type { SidebarThreadSummary } from "./types";

export function getDocumentTitle(
  displayName: string,
  threads: ReadonlyArray<SidebarThreadSummary>,
  lastVisitedAtById: Readonly<Record<string, string>>,
): string {
  let count = 0;
  for (const thread of threads) {
    if (thread.archivedAt !== null || thread.settledOverride === "settled") {
      continue;
    }
    const status = resolveSidebarThreadStatus(thread);
    const hasBackgroundWork = backgroundWorkHoldsCompletion(thread.pendingBackgroundTasks);
    if (
      status === "input" ||
      status === "approval" ||
      (thread.interactionMode === "plan" &&
        !hasBackgroundWork &&
        thread.hasActionableProposedPlan &&
        isLatestRunSettled(thread.latestRun, thread.runtime))
    ) {
      count += 1;
      continue;
    }
    if (thread.latestRun?.status !== "completed" || status !== "ready" || hasBackgroundWork)
      continue;
    const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    const lastVisitedAt = resolveThreadLastVisitedAt(thread.lastVisitedAt, lastVisitedAtById[key]);
    if (hasUnseenCompletion({ ...thread, lastVisitedAt })) count += 1;
  }
  return count > 0 ? `(${count}) ${displayName}` : displayName;
}

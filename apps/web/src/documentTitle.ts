import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { hasUnseenCompletion, resolveSidebarThreadStatus } from "./components/Sidebar.logic";
import type { SidebarThreadSummary } from "./types";

export function getDocumentTitle(
  displayName: string,
  threads: ReadonlyArray<SidebarThreadSummary>,
  lastVisitedAtById: Readonly<Record<string, string>>,
): string {
  let count = 0;
  for (const thread of threads) {
    if (
      thread.archivedAt !== null ||
      thread.settledOverride === "settled" ||
      thread.latestTurn?.state !== "completed" ||
      resolveSidebarThreadStatus(thread) !== "ready"
    ) {
      continue;
    }
    const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    if (hasUnseenCompletion({ ...thread, lastVisitedAt: lastVisitedAtById[key] })) count += 1;
  }
  return count > 0 ? `(${count}) ${displayName}` : displayName;
}

/**
 * SubscriptionHistory - how often a plan has run out.
 *
 * Utilization only climbs inside a rate-limit window and returns to zero when
 * the window resets, so the server keeps one number per window: the highest it
 * reached. This draws those peaks as a row of bars, newest on the right, and
 * says how many of them ran out.
 *
 * This fork keeps its additions in new files, so an upstream change rarely
 * conflicts with them.
 */
import type {
  SubscriptionUsageHistory as SubscriptionUsageHistoryData,
  SubscriptionWindowKind,
} from "@t3tools/contracts";
import {
  AT_LIMIT_UTILIZATION,
  summarizeSubscriptionHistory,
} from "@t3tools/shared/subscriptionUsageHistory";
import { useMemo } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

/** Most recent windows drawn, so the strip stays readable at this width. */
const MAX_BARS = 24;

const WINDOW_LABELS: Record<SubscriptionWindowKind, string> = {
  fiveHour: "5-hour windows",
  sevenDay: "Weekly windows",
};

function PeakBars({
  peaks,
}: {
  peaks: ReadonlyArray<{ resetsAt: string; peakUtilization: number }>;
}) {
  return (
    <span className="flex h-6 items-end gap-px">
      {peaks.map((peak) => {
        const atLimit = peak.peakUtilization >= AT_LIMIT_UTILIZATION;
        return (
          <Tooltip key={peak.resetsAt}>
            <TooltipTrigger
              render={
                <span
                  className={cn(
                    "w-1.5 shrink-0 rounded-sm",
                    atLimit ? "bg-destructive" : "bg-muted-foreground/50",
                  )}
                  style={{
                    // A floor keeps a near-empty window visible as a window
                    // that happened rather than as nothing at all.
                    height: `${Math.max(8, peak.peakUtilization)}%`,
                  }}
                />
              }
            />
            <TooltipPopup side="top">
              {peak.peakUtilization}% used · reset {new Date(peak.resetsAt).toLocaleString()}
            </TooltipPopup>
          </Tooltip>
        );
      })}
    </span>
  );
}

function WindowHistory({
  history,
  window,
  instanceId,
  nowIso,
}: {
  history: SubscriptionUsageHistoryData;
  window: SubscriptionWindowKind;
  instanceId: string;
  nowIso: string;
}) {
  const summary = useMemo(
    () => summarizeSubscriptionHistory(history.peaks, instanceId, window, nowIso),
    [history.peaks, instanceId, window, nowIso],
  );

  if (summary.peaks.length === 0) {
    return null;
  }

  const shown = summary.peaks.slice(-MAX_BARS);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-muted-foreground text-xs">{WINDOW_LABELS[window]}</span>
        <span
          className={cn(
            "text-xs",
            summary.windowsAtLimit > 0 ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {summary.windowsAtLimit === 0
            ? `none of the last ${summary.peaks.length} ran out`
            : `ran out in ${summary.windowsAtLimit} of the last ${summary.peaks.length}`}
        </span>
      </div>
      <PeakBars peaks={shown} />
    </div>
  );
}

export function SubscriptionHistory({
  history,
  instanceId,
  nowIso,
}: {
  readonly history: SubscriptionUsageHistoryData | null;
  readonly instanceId: string;
  readonly nowIso: string;
}) {
  if (history === null || history.peaks.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2 px-2 pt-1 pb-2" data-testid="subscription-history">
      <WindowHistory history={history} window="fiveHour" instanceId={instanceId} nowIso={nowIso} />
      <WindowHistory history={history} window="sevenDay" instanceId={instanceId} nowIso={nowIso} />
    </div>
  );
}

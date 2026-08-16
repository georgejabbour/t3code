/**
 * SubscriptionSelector - pick which Claude subscription new threads use.
 *
 * One Claude provider instance is one claude.ai subscription, because each
 * instance points at its own credentials directory. This panel lists them with
 * the share of each plan still available, and sets the one new threads use.
 *
 * Nothing routes on its own. The subscription changes when a person changes it
 * here, which is what makes the number beside each row worth reading.
 *
 * This fork keeps its additions in new files, so an upstream change rarely
 * conflicts with them.
 */
import type { EnvironmentId, ProviderInstanceId, SubscriptionUsageList } from "@t3tools/contracts";
import {
  describeSubscription,
  summarizeSubscriptionUsage,
  type SubscriptionUsageRow,
} from "@t3tools/shared/subscriptionUsage";
import { CheckIcon, GaugeIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useMemo } from "react";

import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/utils";

export interface SubscriptionSelectorProps {
  readonly usage: SubscriptionUsageList | null;
  readonly isLoading: boolean;
  readonly activeInstanceId: string | null;
  readonly onSelect: (instanceId: ProviderInstanceId) => void;
  readonly onRefresh: () => void;
  readonly onAddSubscription: () => void;
  /** Present so the caller can key a refresh to one environment. */
  readonly environmentId?: EnvironmentId | null;
}

function RemainingBadge({ remainingPercent }: { remainingPercent: number | null }) {
  if (remainingPercent === null) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }
  return (
    <span
      className={cn(
        "text-sm tabular-nums",
        remainingPercent <= 10 ? "text-destructive" : "text-foreground",
      )}
    >
      {remainingPercent}%
    </span>
  );
}

function SubscriptionRow({
  row,
  onSelect,
}: {
  row: SubscriptionUsageRow;
  onSelect: (instanceId: ProviderInstanceId) => void;
}) {
  const { subscription } = row;
  const handleClick = useCallback(() => {
    onSelect(subscription.instanceId);
  }, [onSelect, subscription.instanceId]);

  return (
    <button
      type="button"
      aria-pressed={row.isActive}
      data-testid={`subscription-row-${subscription.instanceId}`}
      onClick={handleClick}
      className="hover:bg-accent flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left"
    >
      <span
        aria-hidden="true"
        className="size-5 shrink-0 rounded-full border"
        style={subscription.accentColor ? { backgroundColor: subscription.accentColor } : undefined}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm">{subscription.displayName}</span>
          {row.isActive ? <CheckIcon aria-label="In use" className="size-3.5 shrink-0" /> : null}
        </span>
        <span className="text-muted-foreground block truncate text-xs">
          {describeSubscription(subscription)}
        </span>
      </span>
      <RemainingBadge remainingPercent={row.remainingPercent} />
    </button>
  );
}

export function SubscriptionSelector({
  usage,
  isLoading,
  activeInstanceId,
  onSelect,
  onRefresh,
  onAddSubscription,
}: SubscriptionSelectorProps) {
  const summary = useMemo(
    () => summarizeSubscriptionUsage(usage?.subscriptions ?? [], activeInstanceId),
    [usage?.subscriptions, activeInstanceId],
  );

  return (
    <div className="w-72" data-testid="subscription-selector">
      <div className="flex items-center gap-2.5 px-2 py-2">
        <GaugeIcon aria-hidden="true" className="text-muted-foreground size-5 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm">Usage remaining</span>
          <span className="text-muted-foreground block text-xs">
            {summary.connectedCount === 1
              ? "1 connected subscription"
              : `${summary.connectedCount} connected subscriptions`}
          </span>
        </span>
        {summary.totalRemainingPercent === null ? null : (
          <span className="text-sm tabular-nums">{summary.totalRemainingPercent}%</span>
        )}
        <Button
          aria-label="Refresh subscription usage"
          size="icon-xs"
          variant="ghost"
          disabled={isLoading}
          onClick={onRefresh}
        >
          {isLoading ? <Spinner className="size-3.5" /> : <RefreshCwIcon className="size-3.5" />}
        </Button>
      </div>

      <div className="bg-border my-1 h-px" role="presentation" />

      {summary.rows.length === 0 ? (
        <p className="text-muted-foreground px-2 py-2 text-xs">
          {isLoading ? "Reading subscriptions…" : "No Claude subscription is connected yet."}
        </p>
      ) : (
        <div className="flex flex-col">
          {summary.rows.map((row) => (
            <SubscriptionRow key={row.subscription.instanceId} row={row} onSelect={onSelect} />
          ))}
        </div>
      )}

      <div className="bg-border my-1 h-px" role="presentation" />

      <button
        type="button"
        data-testid="subscription-add"
        onClick={onAddSubscription}
        className="hover:bg-accent flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left"
      >
        <PlusIcon aria-hidden="true" className="size-5 shrink-0" />
        <span className="text-sm">Add another subscription</span>
      </button>
    </div>
  );
}

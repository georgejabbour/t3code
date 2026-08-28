/**
 * SubscriptionSelector - pick which subscription new threads use.
 *
 * One provider instance is one sign-in, because each instance points at its
 * own credentials directory: a Claude instance is a claude.ai plan, a Codex
 * instance is a ChatGPT plan. This panel lists them with the share of each
 * plan still available, and sets the one new threads use.
 *
 * Every instance that can carry a plan is listed, including one that is turned
 * off. A subscription a person added should stay visible, with a line saying
 * why it shows no number, and a way to reach the Providers screen that governs
 * it. Hiding it made an added subscription look as though it had never been
 * added at all.
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
  describeSubscriptionFreshness,
  summarizeSubscriptionUsage,
  type SubscriptionUsageRow,
  type SubscriptionWindowView,
} from "@t3tools/shared/subscriptionUsage";
import { CheckIcon, GaugeIcon, PlusIcon, RefreshCwIcon, SettingsIcon } from "lucide-react";
import type * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ProviderInstanceIcon } from "~/components/chat/ProviderInstanceIcon";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/utils";

const FIVE_HOUR_MARKS = [20, 40, 60, 80] as const;
const SEVEN_DAY_MARKS = [1, 2, 3, 4, 5, 6].map((day) => (day / 7) * 100);

export interface SubscriptionSelectorProps {
  /** The last reading, kept on screen while a newer one is in flight. */
  readonly usage: SubscriptionUsageList | null;
  /** True while a request for a newer reading is running. */
  readonly isRevalidating: boolean;
  /** When the reading above was taken, or null before the first one arrives. */
  readonly updatedAtMs: number | null;
  readonly activeInstanceId: string | null;
  readonly onSelect: (instanceId: ProviderInstanceId) => void;
  readonly onRefresh: () => void;
  readonly onAddSubscription: () => void;
  /**
   * Opens the Providers screen, where a subscription is turned on or off.
   * Carries the instance a reader pressed, or null when they pressed the entry
   * at the foot of the panel instead.
   */
  readonly onManageSubscription: (instanceId: ProviderInstanceId | null) => void;
  /** Present so the caller can key a refresh to one environment. */
  readonly environmentId?: EnvironmentId | null;
  /** Drawn under the list, for the subscription in use. */
  readonly children?: React.ReactNode;
}

/**
 * One window's numbers, with a bar drawing the same figure.
 *
 * The bar is aria-hidden because the percentage beside it already says the
 * value, and a widget role inside a button is not announced anyway. It fills
 * in the subscription's own colour, so a reader ties a bar to the dot above it
 * without reading the name again.
 */
function WindowLine({
  window,
  accentColor,
}: {
  window: SubscriptionWindowView;
  accentColor: string | null;
}) {
  const remaining = window.remainingPercent;
  const isLow = remaining !== null && remaining <= 10;
  let marks: readonly number[] = [];
  if (window.label === "5h") marks = FIVE_HOUR_MARKS;
  if (window.isLongWindow) marks = SEVEN_DAY_MARKS;
  const markTestId = window.isLongWindow
    ? "subscription-week-day-mark"
    : "subscription-session-hour-mark";
  return (
    <span className="flex flex-col gap-1">
      <span className="flex items-baseline gap-1.5 text-xs">
        <span className="text-muted-foreground w-8 shrink-0">{window.label}</span>
        <span
          className={cn(
            "w-9 shrink-0 tabular-nums",
            isLow ? "text-destructive" : "text-foreground",
          )}
        >
          {remaining === null ? "—" : `${remaining}%`}
        </span>
        {window.resetsIn === null ? null : (
          <span className="text-muted-foreground truncate">resets in {window.resetsIn}</span>
        )}
      </span>
      {remaining === null ? null : (
        <span aria-hidden="true" className="bg-muted-foreground/20 relative block h-1 rounded-full">
          <span
            className={cn(
              "block h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none",
              isLow ? "bg-destructive" : "bg-muted-foreground/50",
            )}
            style={{
              width: `${remaining}%`,
              backgroundColor: isLow ? undefined : (accentColor ?? undefined),
            }}
          />
          {marks.map((position) => (
            <span
              key={position}
              data-testid={markTestId}
              className="bg-background pointer-events-none absolute top-1/2 h-2 w-px -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${position}%` }}
            />
          ))}
        </span>
      )}
    </span>
  );
}

/**
 * One subscription.
 *
 * A row that is turned on picks the subscription new threads use. A row that
 * is turned off cannot be picked, because a thread started on it would find no
 * provider to run, so it opens the Providers screen instead. Both look alike
 * apart from the dimming, so a reader can still read the plan name and the
 * reason it shows no number.
 */
function SubscriptionRow({
  row,
  onSelect,
  onManage,
}: {
  row: SubscriptionUsageRow;
  onSelect: (instanceId: ProviderInstanceId) => void;
  onManage: (instanceId: ProviderInstanceId) => void;
}) {
  const { subscription } = row;
  const isDisabled = !subscription.enabled;
  const handleClick = useCallback(() => {
    if (isDisabled) {
      onManage(subscription.instanceId);
      return;
    }
    onSelect(subscription.instanceId);
  }, [isDisabled, onManage, onSelect, subscription.instanceId]);

  return (
    <button
      type="button"
      aria-pressed={row.isActive}
      data-testid={`subscription-row-${subscription.instanceId}`}
      data-enabled={subscription.enabled}
      onClick={handleClick}
      className="hover:bg-accent flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left"
    >
      <ProviderInstanceIcon
        driverKind={subscription.driver}
        displayName={subscription.displayName}
        accentColor={subscription.accentColor ?? undefined}
        className={cn("mt-0.5 size-5", isDisabled && "opacity-40")}
        iconClassName="size-5"
      />
      <span className={cn("min-w-0 flex-1", isDisabled && "opacity-60")}>
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm">{subscription.displayName}</span>
          {row.isActive ? <CheckIcon aria-label="In use" className="size-3.5 shrink-0" /> : null}
          {isDisabled ? (
            <SettingsIcon
              aria-label="Turned off. Open Providers to turn it back on."
              className="text-muted-foreground ml-auto size-3.5 shrink-0"
            />
          ) : null}
        </span>
        <span className="text-muted-foreground block truncate text-xs">
          {describeSubscription(subscription)}
        </span>
        {row.windows.length === 0 ? null : (
          <span className="mt-1 flex flex-col gap-1.5">
            {row.windows.map((window) => (
              <WindowLine
                key={window.label}
                window={window}
                accentColor={subscription.accentColor}
              />
            ))}
          </span>
        )}
      </span>
    </button>
  );
}

export function SubscriptionSelector({
  usage,
  isRevalidating,
  updatedAtMs,
  activeInstanceId,
  onSelect,
  onRefresh,
  onAddSubscription,
  onManageSubscription,
  children,
}: SubscriptionSelectorProps) {
  // The countdowns are written in minutes at their finest, so a minute tick is
  // all they need. Anything faster would repaint for nothing.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const summary = useMemo(
    () => summarizeSubscriptionUsage(usage?.subscriptions ?? [], activeInstanceId, nowMs),
    [usage?.subscriptions, activeInstanceId, nowMs],
  );

  const handleManageAll = useCallback(() => {
    onManageSubscription(null);
  }, [onManageSubscription]);

  const freshness = describeSubscriptionFreshness({
    hasReading: usage !== null,
    isRevalidating,
    updatedAtMs,
    nowMs,
  });
  // A stale total may already have moved, so it steps back to the muted colour
  // the rest of the panel uses for anything a reader should not act on.
  const isStale = freshness.state === "stale";

  return (
    <div className="w-72" data-testid="subscription-selector" data-freshness={freshness.state}>
      <div className="flex items-center gap-2.5 px-2 py-2">
        <GaugeIcon aria-hidden="true" className="text-muted-foreground size-5 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm">Usage remaining</span>
          {/* Counting the subscriptions before any reading arrives would say
              "0 connected subscriptions", which is a count nobody measured. */}
          {usage === null ? null : (
            <span className="text-muted-foreground block truncate text-xs">
              {summary.connectedCount === 1
                ? "1 connected subscription"
                : `${summary.connectedCount} connected subscriptions`}
            </span>
          )}
        </span>
        {summary.totalRemainingPercent === null ? null : (
          <span className="flex flex-col items-end leading-tight">
            <span
              data-testid="subscription-total-remaining"
              className={cn(
                "text-sm tabular-nums transition-colors duration-300 motion-reduce:transition-none",
                isStale ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {summary.totalRemainingPercent}%
            </span>
            {freshness.label === null ? null : (
              <span className="text-muted-foreground text-[10px]">{freshness.label}</span>
            )}
          </span>
        )}
        <Button
          aria-label={isRevalidating ? "Reading subscription usage" : "Refresh subscription usage"}
          size="icon-xs"
          variant="ghost"
          disabled={isRevalidating}
          onClick={onRefresh}
        >
          {isRevalidating ? (
            <Spinner className="size-3.5" />
          ) : (
            <RefreshCwIcon className="size-3.5" />
          )}
        </Button>
      </div>

      <div className="bg-border my-1 h-px" role="presentation" />

      {summary.rows.length === 0 ? (
        <p className="text-muted-foreground px-2 py-2 text-xs">
          {isRevalidating ? "Reading subscriptions…" : "No subscription is connected yet."}
        </p>
      ) : (
        <div className="flex flex-col">
          {summary.rows.map((row) => (
            <SubscriptionRow
              key={row.subscription.instanceId}
              row={row}
              onSelect={onSelect}
              onManage={onManageSubscription}
            />
          ))}
        </div>
      )}

      {children === undefined || children === null ? null : (
        <>
          <div className="bg-border my-1 h-px" role="presentation" />
          {children}
        </>
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

      <button
        type="button"
        data-testid="subscription-manage"
        onClick={handleManageAll}
        className="hover:bg-accent flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left"
      >
        <SettingsIcon aria-hidden="true" className="size-5 shrink-0" />
        <span className="text-sm">Manage in Providers</span>
      </button>
    </div>
  );
}

/**
 * subscriptionUsage - turn raw plan utilization into what the selector shows.
 *
 * The server reports how much of each subscription's rate-limit window has
 * been spent. A person reading the selector wants the opposite: how much is
 * left. These functions do that conversion in one place, so the web app and
 * the mobile app cannot disagree about it.
 *
 * This fork keeps its additions in new files, so an upstream change rarely
 * conflicts with them.
 *
 * @module subscriptionUsage
 */
import type { SubscriptionUsage } from "@t3tools/contracts";

/** One rate-limit window as the selector draws it. */
export interface SubscriptionWindowView {
  /** Short name of the window, such as "5h" or "Week". */
  readonly label: string;
  /** Percentage still available, 0 to 100, or null when nothing is known. */
  readonly remainingPercent: number | null;
  /** How long until the window resets, such as "2h 14m", or null when unknown. */
  readonly resetsIn: string | null;
}

/** A subscription as the selector draws it. */
export interface SubscriptionUsageRow {
  readonly subscription: SubscriptionUsage;
  /**
   * Percentage of the five-hour window still available, 0 to 100, or null when
   * the subscription reports no window at all. This is the figure the header
   * adds up, because it is the one a person feels within a session.
   */
  readonly remainingPercent: number | null;
  /** Every window the subscription reported, in the order they are shown. */
  readonly windows: ReadonlyArray<SubscriptionWindowView>;
  /** True while this subscription is the one new threads will use. */
  readonly isActive: boolean;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * How long until a window resets, written the way a person would say it.
 *
 * Coarse on purpose. A weekly window reads as "2d 4h" rather than a count of
 * minutes nobody acts on, and anything under a minute says so instead of
 * flickering through the last seconds.
 */
export function formatResetCountdown(resetsAt: string | null, nowMs: number): string | null {
  if (resetsAt === null) {
    return null;
  }
  const resetMs = Date.parse(resetsAt);
  if (Number.isNaN(resetMs)) {
    return null;
  }

  const remaining = resetMs - nowMs;
  if (remaining <= 0) {
    return "now";
  }
  if (remaining < MINUTE_MS) {
    return "under a minute";
  }
  if (remaining < HOUR_MS) {
    return `${Math.floor(remaining / MINUTE_MS)}m`;
  }
  if (remaining < DAY_MS) {
    const hours = Math.floor(remaining / HOUR_MS);
    const minutes = Math.floor((remaining % HOUR_MS) / MINUTE_MS);
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  }
  const days = Math.floor(remaining / DAY_MS);
  const hours = Math.floor((remaining % DAY_MS) / HOUR_MS);
  return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
}

function windowView(
  label: string,
  window: SubscriptionUsage["fiveHour"],
  nowMs: number,
): SubscriptionWindowView | null {
  if (window === null) {
    return null;
  }
  return {
    label,
    remainingPercent: Math.max(0, Math.min(100, Math.round(100 - window.utilization))),
    resetsIn: formatResetCountdown(window.resetsAt, nowMs),
  };
}

/** What the selector shows above the list of subscriptions. */
export interface SubscriptionUsageSummary {
  readonly rows: ReadonlyArray<SubscriptionUsageRow>;
  /** Number of subscriptions that reported a usable window. */
  readonly connectedCount: number;
  /**
   * The remaining percentages added together, as the header shows them. Four
   * subscriptions with 90 each read as 360. Null when none reported a window,
   * because a total of zero would claim there is nothing left rather than that
   * nothing is known.
   */
  readonly totalRemainingPercent: number | null;
}

/**
 * Percentage of a subscription's five-hour window still available.
 *
 * Returns null when the subscription reports no window, which happens for an
 * API key, for Bedrock and Vertex, and for a sign-in whose scope omits the
 * profile. Those cases have no plan limit to report, so there is no number to
 * show and none should be invented.
 */
export function remainingPercentForSubscription(subscription: SubscriptionUsage): number | null {
  const window = subscription.fiveHour;
  if (window === null) {
    return null;
  }
  const remaining = 100 - window.utilization;
  // The SDK has reported a utilization above 100 when a plan is over its
  // allowance. Nothing below zero is left, and saying so beats a negative.
  return Math.max(0, Math.min(100, Math.round(remaining)));
}

/**
 * Build everything the selector draws from the server's report.
 *
 * The order the server sends is kept, so the list matches the order of the
 * instances in settings and does not move under a reader as usage changes.
 */
export function summarizeSubscriptionUsage(
  subscriptions: ReadonlyArray<SubscriptionUsage>,
  activeInstanceId: string | null,
  /** Current time, supplied by the caller so this stays free of the clock. */
  nowMs: number,
): SubscriptionUsageSummary {
  const rows = subscriptions.map((subscription) => ({
    subscription,
    remainingPercent: remainingPercentForSubscription(subscription),
    windows: [
      windowView("5h", subscription.fiveHour, nowMs),
      windowView("Week", subscription.sevenDay, nowMs),
    ].filter((window): window is SubscriptionWindowView => window !== null),
    isActive: subscription.instanceId === activeInstanceId,
  }));

  const known = rows.filter((row) => row.remainingPercent !== null);
  return {
    rows,
    connectedCount: known.length,
    totalRemainingPercent:
      known.length === 0
        ? null
        : known.reduce((total, row) => total + (row.remainingPercent ?? 0), 0),
  };
}

/**
 * The line under a subscription's name.
 *
 * Names the plan when the SDK reported one, and says why a number is missing
 * when it did not. A reader who sees no percentage should learn the reason
 * without opening settings.
 */
export function describeSubscription(subscription: SubscriptionUsage): string {
  const plan = subscription.subscriptionType;
  if (plan !== null) {
    return plan;
  }
  switch (subscription.absence) {
    case "unsupported":
      return "No plan limit on this sign-in";
    case "unavailable":
      return "Usage not reported";
    case "failed":
      return "Usage could not be read";
    case null:
      return "Connected";
  }
}

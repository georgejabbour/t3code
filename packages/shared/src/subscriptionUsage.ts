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

/** A subscription as the selector draws it. */
export interface SubscriptionUsageRow {
  readonly subscription: SubscriptionUsage;
  /**
   * Percentage of the five-hour window still available, 0 to 100, or null when
   * the subscription reports no window at all.
   */
  readonly remainingPercent: number | null;
  /** True while this subscription is the one new threads will use. */
  readonly isActive: boolean;
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
): SubscriptionUsageSummary {
  const rows = subscriptions.map((subscription) => ({
    subscription,
    remainingPercent: remainingPercentForSubscription(subscription),
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

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
  /** True for the longer of a plan's two windows, so a view can rank them. */
  readonly isLongWindow: boolean;
}

/**
 * The account behind a row, as one string.
 *
 * Two rows share an account when they name the same provider and the same
 * signed-in address. Without an address there is nothing to match on, so the
 * instance id keeps the row to itself rather than merging it with a stranger.
 */
export function subscriptionAccountKey(subscription: SubscriptionUsage): string {
  const email = subscription.email?.trim();
  return email && email.length > 0
    ? `${subscription.driver}:${email.toLowerCase()}`
    : `instance:${subscription.instanceId}`;
}

/** A subscription as the selector draws it. */
export interface SubscriptionUsageRow {
  readonly subscription: SubscriptionUsage;
  /**
   * Percentage of the tightest window still available, 0 to 100, or null when
   * the subscription reports no window at all. This is the figure the header
   * adds up, because it is the one a person feels within a sitting.
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

/**
 * How old a reading is, written the way a person would say it.
 *
 * Coarser than the countdown above, because the exact age of a reading is not
 * something anybody acts on. A reader only wants to know whether the numbers
 * are from this minute or from an hour ago.
 */
export function describeReadingAge(updatedAtMs: number, nowMs: number): string {
  // A clock that runs behind the server would otherwise report a reading from
  // the future, so treat anything at or before now as this moment.
  const age = Math.max(0, nowMs - updatedAtMs);
  if (age < MINUTE_MS) {
    return "just now";
  }
  if (age < HOUR_MS) {
    return `${Math.floor(age / MINUTE_MS)}m ago`;
  }
  if (age < DAY_MS) {
    return `${Math.floor(age / HOUR_MS)}h ago`;
  }
  return `${Math.floor(age / DAY_MS)}d ago`;
}

/**
 * Which of three things the panel is showing.
 *
 * The panel keeps the last reading on screen while it asks for a new one, so
 * the numbers alone no longer say how much to trust them. "fresh" means the
 * reading is from this minute. "stale" means it is older and may have moved.
 * "revalidating" means a new reading is on its way. "empty" means there is no
 * reading to show at all, which happens only before the first one arrives.
 */
export type SubscriptionFreshnessState = "empty" | "fresh" | "stale" | "revalidating";

/** The freshness of the reading on screen, and the note the header shows. */
export interface SubscriptionFreshnessView {
  readonly state: SubscriptionFreshnessState;
  /** Short note such as "3m ago", or null when there is nothing to date. */
  readonly label: string | null;
}

/**
 * How long a reading counts as fresh.
 *
 * The panel redraws on a minute tick, so a shorter window would let a reading
 * turn stale before the next tick could redraw the word. The panel would then
 * show "just now" beside the state "stale" and contradict itself.
 */
export const FRESH_READING_MS = MINUTE_MS;

/**
 * Read the freshness of what the panel is showing.
 *
 * Kept apart from the components so both the header note and any styling that
 * follows from it agree, and so the rules have a test of their own.
 */
export function describeSubscriptionFreshness({
  hasReading,
  isRevalidating,
  updatedAtMs,
  nowMs,
  freshWindowMs = FRESH_READING_MS,
}: {
  /** True once a reading exists to show, even an old one. */
  readonly hasReading: boolean;
  /** True while a request for a newer reading is in flight. */
  readonly isRevalidating: boolean;
  /** When the reading on screen was taken, or null when none has arrived. */
  readonly updatedAtMs: number | null;
  readonly nowMs: number;
  readonly freshWindowMs?: number;
}): SubscriptionFreshnessView {
  if (!hasReading) {
    return { state: "empty", label: null };
  }
  // A request in flight outranks the age, because the age is about to change.
  if (isRevalidating) {
    return { state: "revalidating", label: "updating…" };
  }
  if (updatedAtMs === null) {
    return { state: "stale", label: null };
  }
  const label = describeReadingAge(updatedAtMs, nowMs);
  return {
    state: nowMs - updatedAtMs < freshWindowMs ? "fresh" : "stale",
    label,
  };
}

/**
 * One window, ready to draw.
 *
 * The label comes from the server rather than from the slot the window sits
 * in. Claude always reports five hours and a week, but a Codex plan can report
 * a single seven-day window and nothing else, and calling that one "5h"
 * because it arrived in the short slot would state a length nobody measured.
 */
function windowView(
  window: SubscriptionUsage["fiveHour"],
  isLongWindow: boolean,
  nowMs: number,
): SubscriptionWindowView | null {
  if (window === null) {
    return null;
  }
  return {
    label: window.label,
    remainingPercent: Math.max(0, Math.min(100, Math.round(100 - window.utilization))),
    resetsIn: formatResetCountdown(window.resetsAt, nowMs),
    isLongWindow,
  };
}

/** What the selector shows above the list of subscriptions. */
export interface SubscriptionUsageSummary {
  readonly rows: ReadonlyArray<SubscriptionUsageRow>;
  /**
   * Number of separate accounts that reported a usable window.
   *
   * Counts accounts, not rows. Two instances that read one account are one
   * connected subscription, however many rows the list draws for them.
   */
  readonly connectedCount: number;
  /**
   * The remaining percentages added together, as the header shows them. Four
   * accounts with 90 each read as 360. Counted once per account, for the
   * reason above. Null when none reported a window, because a total of zero
   * would claim there is nothing left rather than that nothing is known.
   */
  readonly totalRemainingPercent: number | null;
}

/**
 * Percentage of a subscription's tightest window still available.
 *
 * The short window is the one a person feels within a sitting, so it answers
 * first. A plan that reports only a long window still deserves a number, and a
 * ChatGPT Pro 5x plan is exactly that: it reports one seven-day window and no
 * five-hour one. Reading only the short slot showed that plan as unknown while
 * the panel had its figure in hand.
 *
 * Returns null when the subscription reports no window at all, which happens
 * for an API key, for Bedrock and Vertex, for an instance that is turned off,
 * and for a sign-in whose scope omits the profile. None of those has a plan
 * limit to report, so there is no number to show and none should be invented.
 */
export function remainingPercentForSubscription(subscription: SubscriptionUsage): number | null {
  const window = subscription.fiveHour ?? subscription.sevenDay;
  if (window === null) {
    return null;
  }
  const remaining = 100 - window.utilization;
  // A provider has reported a utilization above 100 when a plan is over its
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
      windowView(subscription.fiveHour, false, nowMs),
      windowView(subscription.sevenDay, true, nowMs),
    ].filter((window): window is SubscriptionWindowView => window !== null),
    isActive: subscription.instanceId === activeInstanceId,
  }));

  // Two instances can read one account, which is what happens when a person
  // keeps a second Codex instance for a different set of launch arguments.
  // Both rows are worth showing, because either can be the one new threads
  // use, but the header must count that account once. Adding it twice would
  // report twice the capacity the account actually has.
  const counted = new Map<string, number>();
  for (const row of rows) {
    if (row.remainingPercent === null) {
      continue;
    }
    const key = subscriptionAccountKey(row.subscription);
    if (!counted.has(key)) {
      counted.set(key, row.remainingPercent);
    }
  }

  return {
    rows,
    connectedCount: counted.size,
    totalRemainingPercent:
      counted.size === 0 ? null : [...counted.values()].reduce((total, value) => total + value, 0),
  };
}

/**
 * Why a subscription shows no percentage, written for a reader.
 *
 * Returns null when a number is on screen and nothing needs explaining.
 */
export function describeSubscriptionAbsence(subscription: SubscriptionUsage): string | null {
  switch (subscription.absence) {
    case "disabled":
      return "Turned off in Providers";
    case "signedOut":
      return "Not signed in";
    case "unsupported":
      return "Billed per token, so no plan limit";
    case "unavailable":
      return "Signed in, but the plan reports no limit";
    case "failed":
      return "Usage could not be read";
    case null:
      return null;
  }
}

/**
 * The line under a subscription's name.
 *
 * Names the plan when the tool reported one, and says why a number is missing
 * when there is none. A reader who sees no percentage should learn the reason
 * without opening settings, and a reader whose plan is named but unread should
 * see both facts rather than only the friendlier one. An account whose
 * organization has switched plan access off reports exactly that: a plan name
 * and no windows.
 */
export function describeSubscription(subscription: SubscriptionUsage): string {
  const plan = subscription.subscriptionType?.trim();
  const reason = describeSubscriptionAbsence(subscription);
  if (plan && plan.length > 0) {
    return reason === null ? plan : `${plan} · ${reason}`;
  }
  return reason ?? "Connected";
}

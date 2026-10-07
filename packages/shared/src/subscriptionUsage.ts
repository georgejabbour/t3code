/** Display data for the subscription selector, derived from native provider snapshots. */
import { isProviderAvailable, type ServerProvider } from "@t3tools/contracts";
import { remainingPercent, formatResetsIn } from "./usageLimits.ts";

export interface SubscriptionWindowView {
  readonly id: string;
  readonly label: string;
  readonly remainingPercent: number;
  readonly resetsIn: string | null;
  readonly isLongWindow: boolean;
}

export interface SubscriptionUsageRow {
  readonly subscription: ServerProvider;
  readonly displayName: string;
  readonly remainingPercent: number | null;
  readonly windows: ReadonlyArray<SubscriptionWindowView>;
  readonly isActive: boolean;
}

/** Without an account address, only the configured instance can identify a row. */
export function subscriptionAccountKey(provider: ServerProvider): string {
  const email = provider.auth.email?.trim().toLowerCase();
  return email ? `${provider.driver}:${email}` : `instance:${provider.instanceId}`;
}

/** Disabled and signed-out snapshots can retain old limits; those limits are not current quota. */
export function subscriptionWindows(provider: ServerProvider) {
  if (
    !provider.enabled ||
    !provider.installed ||
    !isProviderAvailable(provider) ||
    provider.auth.status !== "authenticated" ||
    provider.usageLimits?.unavailable?.reason === "unsupported"
  ) {
    return [];
  }
  return provider.usageLimits?.windows ?? [];
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

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

export interface SubscriptionUsageSummary {
  readonly rows: ReadonlyArray<SubscriptionUsageRow>;
  readonly connectedCount: number;
  readonly totalRemainingPercent: number | null;
  readonly updatedAtMs: number | null;
}

export function remainingPercentForSubscription(provider: ServerProvider): number | null {
  const windows = subscriptionWindows(provider);
  const window = windows.find((window) => window.kind === "session") ?? windows[0];
  return window === undefined ? null : remainingPercent(window);
}

export function summarizeSubscriptionUsage(
  providers: ReadonlyArray<ServerProvider>,
  activeInstanceId: string | null,
  nowMs: number,
): SubscriptionUsageSummary {
  const rows = providers
    .filter((provider) => provider.driver === "claudeAgent" || provider.driver === "codex")
    .map((subscription) => ({
      subscription,
      displayName: subscription.displayName ?? subscription.auth.email ?? subscription.instanceId,
      remainingPercent: remainingPercentForSubscription(subscription),
      windows: subscriptionWindows(subscription).map((window) => ({
        id: window.id,
        label:
          window.kind === "weekly" && (window.label === "Weekly" || window.label === "Week")
            ? "Week"
            : window.windowDurationMins === 300
              ? "5h"
              : window.label,
        remainingPercent: remainingPercent(window),
        resetsIn: formatResetsIn(window, nowMs),
        isLongWindow: window.kind === "weekly",
      })),
      isActive: subscription.instanceId === activeInstanceId,
    }));

  // Show each runnable instance, but add each account's latest reading only once.
  const counted = new Map<string, { remaining: number; checkedAt: string }>();
  for (const row of rows) {
    const limits = row.subscription.usageLimits;
    if (row.remainingPercent === null || limits === undefined) continue;
    const key = subscriptionAccountKey(row.subscription);
    const checkedAt = limits.checkedAt;
    const previous = counted.get(key);
    if (previous === undefined || checkedAt > previous.checkedAt) {
      counted.set(key, { remaining: row.remainingPercent, checkedAt });
    }
  }
  return {
    rows,
    updatedAtMs:
      counted.size === 0
        ? null
        : Math.min(...[...counted.values()].map((reading) => Date.parse(reading.checkedAt))),
    connectedCount: counted.size,
    totalRemainingPercent:
      counted.size === 0
        ? null
        : [...counted.values()].reduce((total, value) => total + value.remaining, 0),
  };
}

export function describeSubscriptionAbsence(provider: ServerProvider): string | null {
  if (!provider.enabled) return "Turned off in Providers";
  if (!provider.installed || !isProviderAvailable(provider)) return "Provider unavailable";
  if (provider.auth.status === "unauthenticated") return "Not signed in";
  if (provider.usageLimits?.unavailable?.reason === "unsupported")
    return "Billed per token, so no plan limit";
  if (provider.usageLimits?.unavailable?.reason === "probeFailed") return "Usage could not be read";
  if (subscriptionWindows(provider).length === 0) return "Usage unavailable";
  return null;
}

export function describeSubscription(provider: ServerProvider): string {
  const plan = provider.auth.label?.trim();
  const reason = describeSubscriptionAbsence(provider);
  return plan ? (reason === null ? plan : `${plan} · ${reason}`) : (reason ?? "Connected");
}

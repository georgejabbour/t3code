/** Peak history from native usage windows. Old records remain unattributed. */
import type { ServerProvider, SubscriptionWindowPeak } from "@t3tools/contracts";
import { subscriptionAccountKey, subscriptionWindows } from "./subscriptionUsage.ts";

export const AT_LIMIT_UTILIZATION = 95;

/** An instance alone cannot distinguish a changed sign-in. */
export function subscriptionHistoryAccountKey(provider: ServerProvider): string | null {
  return provider.auth.status === "authenticated" && provider.auth.email?.trim()
    ? subscriptionAccountKey(provider)
    : null;
}

function keyOf(
  peak: Pick<SubscriptionWindowPeak, "accountKey" | "instanceId" | "window" | "resetsAt">,
): string {
  return JSON.stringify([
    peak.accountKey ?? `legacy:${peak.instanceId}`,
    peak.window,
    peak.resetsAt,
  ]);
}

export function recordSubscriptionSample(
  peaks: ReadonlyArray<SubscriptionWindowPeak>,
  provider: ServerProvider,
): ReadonlyArray<SubscriptionWindowPeak> {
  const accountKey = subscriptionHistoryAccountKey(provider);
  const limits = provider.usageLimits;
  if (accountKey === null || limits === undefined) return peaks;
  const byKey = new Map(peaks.map((peak) => [keyOf(peak), peak]));
  let changed = false;
  for (const window of subscriptionWindows(provider)) {
    if (window.resetsAt === undefined) continue;
    const candidate = {
      instanceId: provider.instanceId,
      accountKey,
      window: window.id,
      label:
        window.label === "Weekly" || window.label === "Week"
          ? "Weekly windows"
          : window.windowDurationMins === 300
            ? "5-hour windows"
            : `${window.label} windows`,
      resetsAt: window.resetsAt,
    };
    const key = keyOf(candidate);
    const existing = byKey.get(key);
    if (
      existing &&
      limits.checkedAt <= existing.lastSampledAt &&
      window.usedPercent <= existing.peakUtilization
    )
      continue;
    changed = true;
    byKey.set(key, {
      ...candidate,
      peakUtilization: Math.max(existing?.peakUtilization ?? 0, window.usedPercent),
      firstSampledAt:
        existing && existing.firstSampledAt < limits.checkedAt
          ? existing.firstSampledAt
          : limits.checkedAt,
      lastSampledAt:
        existing && existing.lastSampledAt > limits.checkedAt
          ? existing.lastSampledAt
          : limits.checkedAt,
      sampleCount: (existing?.sampleCount ?? 0) + 1,
    });
  }
  return changed ? [...byKey.values()].sort((a, b) => a.resetsAt.localeCompare(b.resetsAt)) : peaks;
}

export function pruneSubscriptionHistory(
  peaks: ReadonlyArray<SubscriptionWindowPeak>,
  cutoffIso: string,
) {
  return peaks.filter((peak) => peak.resetsAt >= cutoffIso);
}

export interface SubscriptionWindowHistory {
  readonly window: string;
  readonly label: string;
  readonly peaks: ReadonlyArray<SubscriptionWindowPeak>;
  readonly windowsAtLimit: number;
}

/** Keep legacy instance history visible, but separate from the current account's counts. */
export function summarizeSubscriptionHistory(
  peaks: ReadonlyArray<SubscriptionWindowPeak>,
  provider: ServerProvider,
  nowIso: string,
): ReadonlyArray<SubscriptionWindowHistory> {
  const accountKey = subscriptionHistoryAccountKey(provider);
  const groups = new Map<string, SubscriptionWindowPeak[]>();
  for (const peak of peaks) {
    const legacy = peak.accountKey === undefined;
    if (
      peak.resetsAt > nowIso ||
      (legacy
        ? peak.instanceId !== provider.instanceId
        : accountKey === null || peak.accountKey !== accountKey)
    )
      continue;
    const key = JSON.stringify([legacy, peak.window]);
    const group = groups.get(key) ?? [];
    group.push(peak);
    groups.set(key, group);
  }
  return [...groups].map(([window, group]) => ({
    window,
    label:
      group[0]!.accountKey === undefined
        ? group[0]!.window === "sevenDay"
          ? "Earlier weekly windows"
          : group[0]!.window === "fiveHour"
            ? "Earlier 5-hour windows"
            : "Earlier windows"
        : (group[0]!.label ?? "Usage windows"),
    peaks: group.sort((a, b) => a.resetsAt.localeCompare(b.resetsAt)),
    windowsAtLimit: group.filter((peak) => peak.peakUtilization >= AT_LIMIT_UTILIZATION).length,
  }));
}

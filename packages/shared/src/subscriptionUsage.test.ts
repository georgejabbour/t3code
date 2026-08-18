import { ProviderInstanceId, type SubscriptionUsage } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  formatResetCountdown,
  describeReadingAge,
  describeSubscription,
  describeSubscriptionFreshness,
  remainingPercentForSubscription,
  summarizeSubscriptionUsage,
} from "./subscriptionUsage.ts";

const NOW = Date.parse("2026-08-16T12:00:00.000Z");

const subscription = (
  id: string,
  overrides: Partial<SubscriptionUsage> = {},
): SubscriptionUsage => ({
  instanceId: ProviderInstanceId.make(id),
  displayName: id,
  accentColor: null,
  email: null,
  subscriptionType: "max",
  fiveHour: { utilization: 10, resetsAt: null },
  sevenDay: null,
  absence: null,
  collectedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("remainingPercentForSubscription", () => {
  it("reports what is left of the five-hour window", () => {
    expect(
      remainingPercentForSubscription(
        subscription("a", { fiveHour: { utilization: 12, resetsAt: null } }),
      ),
    ).toBe(88);
  });

  it("reports nothing when the subscription has no window", () => {
    expect(
      remainingPercentForSubscription(
        subscription("a", { fiveHour: null, absence: "unsupported" }),
      ),
    ).toBeNull();
  });

  it("never reports less than nothing when a plan is over its allowance", () => {
    expect(
      remainingPercentForSubscription(
        subscription("a", { fiveHour: { utilization: 100, resetsAt: null } }),
      ),
    ).toBe(0);
  });
});

describe("summarizeSubscriptionUsage", () => {
  it("adds the remaining percentages the way the header shows them", () => {
    const summary = summarizeSubscriptionUsage(
      [
        subscription("a", { fiveHour: { utilization: 12, resetsAt: null } }),
        subscription("b", { fiveHour: { utilization: 10, resetsAt: null } }),
        subscription("c", { fiveHour: { utilization: 10, resetsAt: null } }),
        subscription("d", { fiveHour: { utilization: 8, resetsAt: null } }),
      ],
      null,
      NOW,
    );

    expect(summary.connectedCount).toBe(4);
    expect(summary.totalRemainingPercent).toBe(360);
  });

  it("marks the subscription new threads will use", () => {
    const summary = summarizeSubscriptionUsage(
      [subscription("primary"), subscription("second")],
      "second",
      NOW,
    );

    expect(summary.rows.map((row) => row.isActive)).toEqual([false, true]);
  });

  it("keeps the order the server sent", () => {
    const summary = summarizeSubscriptionUsage(
      [
        subscription("a", { fiveHour: { utilization: 90, resetsAt: null } }),
        subscription("b", { fiveHour: { utilization: 1, resetsAt: null } }),
      ],
      null,
      NOW,
    );

    expect(summary.rows.map((row) => row.subscription.instanceId)).toEqual(["a", "b"]);
  });

  it("counts only the subscriptions that reported a window", () => {
    const summary = summarizeSubscriptionUsage(
      [
        subscription("a", { fiveHour: { utilization: 20, resetsAt: null } }),
        subscription("b", { fiveHour: null, absence: "unsupported" }),
      ],
      null,
      NOW,
    );

    expect(summary.connectedCount).toBe(1);
    expect(summary.totalRemainingPercent).toBe(80);
    expect(summary.rows[1]?.remainingPercent).toBeNull();
  });

  it("reports no total when nothing is known, rather than zero", () => {
    // A zero would read as "nothing left". Null reads as "not known", which is
    // what an API-key-only setup should show.
    const summary = summarizeSubscriptionUsage(
      [subscription("a", { fiveHour: null, absence: "unsupported" })],
      null,
      NOW,
    );

    expect(summary.totalRemainingPercent).toBeNull();
  });
});

describe("formatResetCountdown", () => {
  const now = Date.parse("2026-08-16T12:00:00.000Z");

  it("counts a weekly window down in days and hours", () => {
    expect(formatResetCountdown("2026-08-18T16:00:00.000Z", now)).toBe("2d 4h");
  });

  it("drops the hours when a day lands exactly", () => {
    expect(formatResetCountdown("2026-08-18T12:00:00.000Z", now)).toBe("2d");
  });

  it("counts a five-hour window down in hours and minutes", () => {
    expect(formatResetCountdown("2026-08-16T14:14:00.000Z", now)).toBe("2h 14m");
  });

  it("counts the last hour down in minutes", () => {
    expect(formatResetCountdown("2026-08-16T12:43:00.000Z", now)).toBe("43m");
  });

  it("says so rather than flickering through the last seconds", () => {
    expect(formatResetCountdown("2026-08-16T12:00:30.000Z", now)).toBe("under a minute");
  });

  it("reads a window that has already reset as now", () => {
    expect(formatResetCountdown("2026-08-16T11:00:00.000Z", now)).toBe("now");
  });

  it("reports nothing for a missing or unreadable time", () => {
    expect(formatResetCountdown(null, now)).toBeNull();
    expect(formatResetCountdown("not a time", now)).toBeNull();
  });

  it("reads the offset format the provider actually sends", () => {
    // The live answer carries "+00:00" rather than "Z".
    expect(formatResetCountdown("2026-08-16T17:00:00.137018+00:00", now)).toBe("5h");
  });
});

describe("the windows a row shows", () => {
  const now = Date.parse("2026-08-16T12:00:00.000Z");

  it("shows both windows, each with what is left and when it resets", () => {
    const summary = summarizeSubscriptionUsage(
      [
        subscription("a", {
          fiveHour: { utilization: 11, resetsAt: "2026-08-16T17:00:00.000Z" },
          sevenDay: { utilization: 20, resetsAt: "2026-08-18T16:00:00.000Z" },
        }),
      ],
      null,
      now,
    );

    expect(summary.rows[0]?.windows).toEqual([
      { label: "5h", remainingPercent: 89, resetsIn: "5h" },
      { label: "Week", remainingPercent: 80, resetsIn: "2d 4h" },
    ]);
  });

  it("shows only the windows the provider reported", () => {
    const summary = summarizeSubscriptionUsage(
      [subscription("a", { fiveHour: { utilization: 5, resetsAt: null }, sevenDay: null })],
      null,
      now,
    );

    expect(summary.rows[0]?.windows).toEqual([
      { label: "5h", remainingPercent: 95, resetsIn: null },
    ]);
  });

  it("shows no windows when nothing is known", () => {
    const summary = summarizeSubscriptionUsage(
      [subscription("a", { fiveHour: null, sevenDay: null, absence: "unsupported" })],
      null,
      now,
    );

    expect(summary.rows[0]?.windows).toEqual([]);
  });
});

describe("describeSubscription", () => {
  it("names the plan when the provider reported one", () => {
    expect(describeSubscription(subscription("a", { subscriptionType: "pro" }))).toBe("pro");
  });

  it("says why a percentage is missing", () => {
    expect(
      describeSubscription(
        subscription("a", { subscriptionType: null, fiveHour: null, absence: "unsupported" }),
      ),
    ).toBe("No plan limit on this sign-in");
    expect(
      describeSubscription(
        subscription("a", { subscriptionType: null, fiveHour: null, absence: "failed" }),
      ),
    ).toBe("Usage could not be read");
  });
});

describe("describeReadingAge", () => {
  it("writes the age in the largest unit that fits", () => {
    expect(describeReadingAge(NOW - 30_000, NOW)).toBe("just now");
    expect(describeReadingAge(NOW - 3 * 60_000, NOW)).toBe("3m ago");
    expect(describeReadingAge(NOW - 2 * 3_600_000, NOW)).toBe("2h ago");
    expect(describeReadingAge(NOW - 3 * 86_400_000, NOW)).toBe("3d ago");
  });

  it("reads a clock that runs behind the server as this moment", () => {
    expect(describeReadingAge(NOW + 5_000, NOW)).toBe("just now");
  });
});

describe("describeSubscriptionFreshness", () => {
  const read = (overrides: Partial<Parameters<typeof describeSubscriptionFreshness>[0]> = {}) =>
    describeSubscriptionFreshness({
      hasReading: true,
      isRevalidating: false,
      updatedAtMs: NOW,
      nowMs: NOW,
      ...overrides,
    });

  it("is empty before the first reading arrives", () => {
    expect(read({ hasReading: false, updatedAtMs: null })).toEqual({
      state: "empty",
      label: null,
    });
  });

  it("stays empty while the first reading is still on its way", () => {
    expect(read({ hasReading: false, updatedAtMs: null, isRevalidating: true })).toEqual({
      state: "empty",
      label: null,
    });
  });

  it("calls a reading from this minute fresh", () => {
    expect(read({ updatedAtMs: NOW - 20_000 })).toEqual({ state: "fresh", label: "just now" });
  });

  it("calls an older reading stale and dates it", () => {
    expect(read({ updatedAtMs: NOW - 4 * 60_000 })).toEqual({ state: "stale", label: "4m ago" });
  });

  it("reports a request in flight even when the reading is still fresh", () => {
    expect(read({ updatedAtMs: NOW, isRevalidating: true })).toEqual({
      state: "revalidating",
      label: "updating…",
    });
  });

  it("calls a reading of unknown age stale rather than claim it is fresh", () => {
    expect(read({ updatedAtMs: null })).toEqual({ state: "stale", label: null });
  });
});

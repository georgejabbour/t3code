import { ProviderInstanceId, type SubscriptionUsage } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  describeSubscription,
  remainingPercentForSubscription,
  summarizeSubscriptionUsage,
} from "./subscriptionUsage.ts";

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
    );

    expect(summary.connectedCount).toBe(4);
    expect(summary.totalRemainingPercent).toBe(360);
  });

  it("marks the subscription new threads will use", () => {
    const summary = summarizeSubscriptionUsage(
      [subscription("primary"), subscription("second")],
      "second",
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
    );

    expect(summary.totalRemainingPercent).toBeNull();
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

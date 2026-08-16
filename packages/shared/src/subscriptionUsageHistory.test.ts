import { ProviderInstanceId, type SubscriptionUsage } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  pruneSubscriptionHistory,
  recordSubscriptionSample,
  summarizeSubscriptionHistory,
} from "./subscriptionUsageHistory.ts";

const subscription = (overrides: Partial<SubscriptionUsage> = {}): SubscriptionUsage => ({
  instanceId: ProviderInstanceId.make("personal"),
  displayName: "Personal",
  accentColor: null,
  email: null,
  subscriptionType: "max",
  fiveHour: { utilization: 10, resetsAt: "2026-08-16T17:00:00.000Z" },
  sevenDay: { utilization: 20, resetsAt: "2026-08-18T15:00:00.000Z" },
  absence: null,
  collectedAt: "2026-08-16T12:00:00.000Z",
  ...overrides,
});

describe("recordSubscriptionSample", () => {
  it("records a window the first time it is seen", () => {
    const peaks = recordSubscriptionSample([], subscription(), "2026-08-16T12:00:00.000Z");

    expect(peaks).toHaveLength(2);
    expect(peaks[0]).toMatchObject({
      window: "fiveHour",
      resetsAt: "2026-08-16T17:00:00.000Z",
      peakUtilization: 10,
      sampleCount: 1,
    });
  });

  it("keeps the highest reading for a window rather than the latest", () => {
    // Utilization only climbs, but a provider that reports a dip must not
    // erase the peak the window actually reached.
    let peaks = recordSubscriptionSample([], subscription(), "2026-08-16T12:00:00.000Z");
    peaks = recordSubscriptionSample(
      peaks,
      subscription({ fiveHour: { utilization: 80, resetsAt: "2026-08-16T17:00:00.000Z" } }),
      "2026-08-16T14:00:00.000Z",
    );
    peaks = recordSubscriptionSample(
      peaks,
      subscription({ fiveHour: { utilization: 60, resetsAt: "2026-08-16T17:00:00.000Z" } }),
      "2026-08-16T15:00:00.000Z",
    );

    const fiveHour = peaks.filter((peak) => peak.window === "fiveHour");
    expect(fiveHour).toHaveLength(1);
    expect(fiveHour[0]?.peakUtilization).toBe(80);
    expect(fiveHour[0]?.sampleCount).toBe(3);
    expect(fiveHour[0]?.firstSampledAt).toBe("2026-08-16T12:00:00.000Z");
    expect(fiveHour[0]?.lastSampledAt).toBe("2026-08-16T15:00:00.000Z");
  });

  it("starts a new row once the window resets", () => {
    let peaks = recordSubscriptionSample(
      [],
      subscription({ fiveHour: { utilization: 96, resetsAt: "2026-08-16T17:00:00.000Z" } }),
      "2026-08-16T16:00:00.000Z",
    );
    peaks = recordSubscriptionSample(
      peaks,
      subscription({ fiveHour: { utilization: 3, resetsAt: "2026-08-16T22:00:00.000Z" } }),
      "2026-08-16T17:30:00.000Z",
    );

    const fiveHour = peaks.filter((peak) => peak.window === "fiveHour");
    expect(fiveHour.map((peak) => peak.peakUtilization)).toEqual([96, 3]);
  });

  it("skips a window with no reset time, which has no identity", () => {
    const peaks = recordSubscriptionSample(
      [],
      subscription({ fiveHour: { utilization: 40, resetsAt: null }, sevenDay: null }),
      "2026-08-16T12:00:00.000Z",
    );

    expect(peaks).toEqual([]);
  });

  it("keeps subscriptions apart", () => {
    let peaks = recordSubscriptionSample([], subscription(), "2026-08-16T12:00:00.000Z");
    peaks = recordSubscriptionSample(
      peaks,
      subscription({ instanceId: ProviderInstanceId.make("hermes") }),
      "2026-08-16T12:00:00.000Z",
    );

    expect(peaks.filter((peak) => peak.window === "fiveHour")).toHaveLength(2);
  });
});

describe("pruneSubscriptionHistory", () => {
  it("drops windows that reset before the cutoff", () => {
    const peaks = recordSubscriptionSample([], subscription(), "2026-08-16T12:00:00.000Z");

    expect(pruneSubscriptionHistory(peaks, "2026-08-17T00:00:00.000Z")).toHaveLength(1);
    expect(pruneSubscriptionHistory(peaks, "2026-08-19T00:00:00.000Z")).toHaveLength(0);
  });
});

describe("summarizeSubscriptionHistory", () => {
  const peaks = [
    {
      instanceId: ProviderInstanceId.make("personal"),
      window: "fiveHour" as const,
      resetsAt: "2026-08-15T17:00:00.000Z",
      peakUtilization: 99,
      firstSampledAt: "2026-08-15T13:00:00.000Z",
      lastSampledAt: "2026-08-15T16:30:00.000Z",
      sampleCount: 8,
    },
    {
      instanceId: ProviderInstanceId.make("personal"),
      window: "fiveHour" as const,
      resetsAt: "2026-08-15T22:00:00.000Z",
      peakUtilization: 40,
      firstSampledAt: "2026-08-15T18:00:00.000Z",
      lastSampledAt: "2026-08-15T21:00:00.000Z",
      sampleCount: 6,
    },
    {
      instanceId: ProviderInstanceId.make("personal"),
      window: "fiveHour" as const,
      resetsAt: "2026-08-16T17:00:00.000Z",
      peakUtilization: 12,
      firstSampledAt: "2026-08-16T12:00:00.000Z",
      lastSampledAt: "2026-08-16T12:30:00.000Z",
      sampleCount: 2,
    },
  ];

  it("counts how many closed windows ran out", () => {
    const summary = summarizeSubscriptionHistory(
      peaks,
      "personal",
      "fiveHour",
      "2026-08-16T13:00:00.000Z",
    );

    expect(summary.peaks).toHaveLength(2);
    expect(summary.windowsAtLimit).toBe(1);
    expect(summary.worstPeak).toBe(99);
  });

  it("leaves out the window still open, which is only part-way through", () => {
    const summary = summarizeSubscriptionHistory(
      peaks,
      "personal",
      "fiveHour",
      "2026-08-16T13:00:00.000Z",
    );

    expect(summary.peaks.map((peak) => peak.resetsAt)).not.toContain("2026-08-16T17:00:00.000Z");
  });

  it("reports nothing for a subscription with no record", () => {
    const summary = summarizeSubscriptionHistory(
      peaks,
      "hermes",
      "fiveHour",
      "2026-08-16T13:00:00.000Z",
    );

    expect(summary.peaks).toEqual([]);
    expect(summary.worstPeak).toBeNull();
  });
});

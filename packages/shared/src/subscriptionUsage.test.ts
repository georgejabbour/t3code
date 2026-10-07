import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  describeReadingAge,
  describeSubscription,
  describeSubscriptionFreshness,
  remainingPercentForSubscription,
  summarizeSubscriptionUsage,
} from "./subscriptionUsage.ts";
const NOW = Date.parse("2026-08-16T12:00:00.000Z");
const window = {
  id: "primary",
  kind: "session",
  label: "Session",
  usedPercent: 23,
  windowDurationMins: 300,
} as const;
const provider = (overrides: Partial<ServerProvider> = {}): ServerProvider => ({
  instanceId: ProviderInstanceId.make("personal"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated", email: "me@example.com", label: "ChatGPT Pro 20x" },
  checkedAt: "2026-08-16T12:00:00.000Z",
  models: [],
  skills: [],
  slashCommands: [],
  usageLimits: { checkedAt: "2026-08-16T12:00:00.000Z", windows: [window] },
  ...overrides,
});
describe("native subscription rows", () => {
  it("keeps the popover total and configured rows", () => {
    const summary = summarizeSubscriptionUsage(
      [
        provider(),
        provider({
          instanceId: ProviderInstanceId.make("other"),
          auth: { status: "authenticated", email: "other@example.com" },
          usageLimits: {
            checkedAt: "2026-08-16T12:00:00.000Z",
            windows: [{ ...window, usedPercent: 34 }],
          },
        }),
        provider({ instanceId: ProviderInstanceId.make("off"), enabled: false }),
      ],
      "other",
      NOW,
    );
    expect(summary.totalRemainingPercent).toBe(143);
    expect(summary.connectedCount).toBe(2);
    expect(summary.rows).toHaveLength(3);
    expect(summary.rows[1]?.isActive).toBe(true);
    expect(summary.rows[2]?.windows).toEqual([]);
  });
  it("counts the freshest reading of one account once", () => {
    const summary = summarizeSubscriptionUsage(
      [
        provider(),
        provider({
          instanceId: ProviderInstanceId.make("same"),
          auth: { status: "authenticated", email: " ME@EXAMPLE.COM " },
          usageLimits: {
            checkedAt: "2026-08-16T12:01:00.000Z",
            windows: [{ ...window, usedPercent: 50 }],
          },
        }),
      ],
      null,
      NOW,
    );
    expect(summary.connectedCount).toBe(1);
    expect(summary.totalRemainingPercent).toBe(50);
    expect(summary.updatedAtMs).toBe(Date.parse("2026-08-16T12:01:00.000Z"));
    expect(summary.rows).toHaveLength(2);
  });
  it("shows weekly-only and additional native windows without fixed slots", () => {
    const weekly = {
      ...window,
      id: "weekly-codex",
      kind: "weekly" as const,
      label: "Weekly",
      windowDurationMins: 10080,
    };
    const usage = provider({
      usageLimits: {
        checkedAt: provider().checkedAt,
        windows: [weekly, { ...weekly, id: "weekly-model", label: "Model allowance" }],
      },
    });
    expect(remainingPercentForSubscription(usage)).toBe(77);
    expect(
      summarizeSubscriptionUsage([usage], null, NOW).rows[0]?.windows.map((w) => w.id),
    ).toEqual(["weekly-codex", "weekly-model"]);
  });
  it("does not add carried limits for disabled, signed-out, or unsupported accounts", () => {
    const signedOut = provider({ auth: { status: "unauthenticated" } });
    const disabled = provider({ enabled: false });
    const unsupported = provider({
      usageLimits: {
        checkedAt: provider().checkedAt,
        windows: [window],
        unavailable: { reason: "unsupported" },
      },
    });
    expect(
      summarizeSubscriptionUsage([signedOut, disabled, unsupported], null, NOW)
        .totalRemainingPercent,
    ).toBeNull();
    expect(describeSubscription(disabled)).toContain("Turned off");
    expect(describeSubscription(signedOut)).toBe("Not signed in");
  });
  it("shows unknown quota without inventing zero and keeps native failure reasons", () => {
    const unknown = provider({ usageLimits: undefined });
    expect(remainingPercentForSubscription(unknown)).toBeNull();
    expect(describeSubscription(unknown)).toContain("Usage unavailable");
    expect(
      describeSubscription(
        provider({
          usageLimits: {
            checkedAt: provider().checkedAt,
            windows: [],
            unavailable: { reason: "probeFailed" },
          },
        }),
      ),
    ).toContain("could not be read");
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

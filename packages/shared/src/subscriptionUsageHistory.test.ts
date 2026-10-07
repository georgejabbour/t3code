import {
  ProviderDriverKind,
  ProviderInstanceId,
  SubscriptionUsageHistory,
  type ServerProvider,
  type SubscriptionWindowPeak,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import {
  recordSubscriptionSample,
  pruneSubscriptionHistory,
  summarizeSubscriptionHistory,
} from "./subscriptionUsageHistory.ts";
const decodeHistory = Schema.decodeSync(Schema.fromJsonString(SubscriptionUsageHistory));
const observedAt = "2026-10-01T12:00:00.000Z";
const reset = "2026-10-02T12:00:00.000Z";
const weekly = {
  id: "seven_day",
  kind: "weekly",
  label: "Weekly",
  usedPercent: 99,
  resetsAt: reset,
} as const;
const provider = (overrides: Partial<ServerProvider> = {}): ServerProvider => ({
  instanceId: ProviderInstanceId.make("personal"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated", email: "me@example.com" },
  checkedAt: observedAt,
  models: [],
  slashCommands: [],
  skills: [],
  usageLimits: { checkedAt: observedAt, windows: [weekly] },
  ...overrides,
});
const legacy: SubscriptionWindowPeak = {
  instanceId: ProviderInstanceId.make("personal"),
  window: "sevenDay",
  resetsAt: reset,
  peakUtilization: 30,
  firstSampledAt: observedAt,
  lastSampledAt: observedAt,
  sampleCount: 47,
};
describe("native quota history", () => {
  it("preserves old JSON records without assigning today's account", () => {
    const old = decodeHistory(JSON.stringify({ peaks: [legacy] }));
    const peaks = recordSubscriptionSample(old.peaks, provider());
    expect(peaks).toHaveLength(2);
    expect(peaks[0]).toEqual(legacy);
    const history = summarizeSubscriptionHistory(peaks, provider(), "2026-10-03T00:00:00.000Z");
    expect(history.map((row) => [row.label, row.windowsAtLimit])).toEqual([
      ["Earlier weekly windows", 0],
      ["Weekly windows", 1],
    ]);
  });
  it("keeps peaks and ignores repeated snapshot samples", () => {
    const first = recordSubscriptionSample([], provider());
    expect(recordSubscriptionSample(first, provider())).toBe(first);
    const later = recordSubscriptionSample(
      first,
      provider({
        usageLimits: {
          checkedAt: "2026-10-01T13:00:00.000Z",
          windows: [{ ...weekly, usedPercent: 40 }],
        },
      }),
    );
    expect(later[0]).toMatchObject({
      peakUtilization: 99,
      sampleCount: 2,
      firstSampledAt: observedAt,
      lastSampledAt: "2026-10-01T13:00:00.000Z",
    });
  });
  it("separates new windows and account changes on one instance", () => {
    let peaks = recordSubscriptionSample([], provider());
    const other = provider({ auth: { status: "authenticated", email: "other@example.com" } });
    peaks = recordSubscriptionSample(peaks, other);
    peaks = recordSubscriptionSample(
      peaks,
      provider({
        usageLimits: {
          checkedAt: observedAt,
          windows: [{ ...weekly, resetsAt: "2026-10-09T12:00:00.000Z" }],
        },
      }),
    );
    expect(peaks).toHaveLength(3);
    expect(
      summarizeSubscriptionHistory(peaks, other, "2026-10-03T00:00:00.000Z")[0]?.peaks,
    ).toHaveLength(1);
  });
  it("shares account history across instances without counting a sample twice", () => {
    const peaks = recordSubscriptionSample([], provider());
    const duplicate = provider({ instanceId: ProviderInstanceId.make("second") });
    expect(recordSubscriptionSample(peaks, duplicate)).toBe(peaks);
    expect(
      summarizeSubscriptionHistory(peaks, duplicate, "2026-10-03T00:00:00.000Z")[0]?.peaks,
    ).toHaveLength(1);
  });
  it("keeps multiple weekly IDs separate and excludes open windows", () => {
    const peaks = recordSubscriptionSample(
      [],
      provider({
        usageLimits: {
          checkedAt: observedAt,
          windows: [weekly, { ...weekly, id: "weekly-model", label: "Sonnet allowance" }],
        },
      }),
    );
    expect(summarizeSubscriptionHistory(peaks, provider(), observedAt)).toEqual([]);
    expect(
      summarizeSubscriptionHistory(peaks, provider(), "2026-10-03T00:00:00.000Z"),
    ).toHaveLength(2);
    expect(
      summarizeSubscriptionHistory(peaks, provider(), "2026-10-03T00:00:00.000Z").map(
        (row) => row.label,
      ),
    ).toEqual(["Weekly windows", "Sonnet allowance windows"]);
  });
  it("skips unknown account identities, disabled providers, and windows without resets", () => {
    expect(recordSubscriptionSample([], provider({ auth: { status: "authenticated" } }))).toEqual(
      [],
    );
    expect(recordSubscriptionSample([], provider({ enabled: false }))).toEqual([]);
    expect(
      recordSubscriptionSample(
        [],
        provider({
          usageLimits: { checkedAt: observedAt, windows: [{ ...weekly, resetsAt: undefined }] },
        }),
      ),
    ).toEqual([]);
  });
  it("retains chronological sample times when updates arrive out of order", () => {
    const peaks = recordSubscriptionSample(
      recordSubscriptionSample([], provider()),
      provider({
        usageLimits: {
          checkedAt: "2026-10-01T11:00:00.000Z",
          windows: [{ ...weekly, usedPercent: 100 }],
        },
      }),
    );
    expect(peaks[0]).toMatchObject({
      firstSampledAt: "2026-10-01T11:00:00.000Z",
      lastSampledAt: observedAt,
      peakUtilization: 100,
    });
    expect(pruneSubscriptionHistory(peaks, "2026-10-03T00:00:00.000Z")).toEqual([]);
  });
  it("keeps a native ID that resembles a legacy key separate", () => {
    const peaks = recordSubscriptionSample(
      [legacy],
      provider({
        usageLimits: { checkedAt: observedAt, windows: [{ ...weekly, id: "legacy:sevenDay" }] },
      }),
    );
    const summary = summarizeSubscriptionHistory(peaks, provider(), "2026-10-03T00:00:00.000Z");
    expect(summary).toHaveLength(2);
    expect(summary.map((row) => row.label)).toEqual(["Earlier weekly windows", "Weekly windows"]);
  });
});

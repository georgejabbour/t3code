import { describe, expect, it } from "vite-plus/test";

import { readSubscriptionUsageResponse } from "./ClaudeSubscriptionUsage.ts";

const account = { email: "george@example.com", subscriptionType: "max" };

describe("readSubscriptionUsageResponse", () => {
  it("reads the five-hour and seven-day windows", () => {
    const probe = readSubscriptionUsageResponse(
      {
        subscription_type: "max",
        rate_limits_available: true,
        rate_limits: {
          five_hour: { utilization: 12, resets_at: "2026-01-01T05:00:00.000Z" },
          seven_day: { utilization: 40, resets_at: "2026-01-07T00:00:00.000Z" },
        },
      },
      account,
    );

    expect(probe.fiveHour).toEqual({ utilization: 12, resetsAt: "2026-01-01T05:00:00.000Z" });
    expect(probe.sevenDay).toEqual({ utilization: 40, resetsAt: "2026-01-07T00:00:00.000Z" });
    expect(probe.absence).toBeNull();
    expect(probe.email).toBe("george@example.com");
    expect(probe.subscriptionType).toBe("max");
  });

  it("reports an API key sign-in as having no plan limit", () => {
    // The SDK sets this for an API key, Bedrock and Vertex.
    const probe = readSubscriptionUsageResponse(
      { subscription_type: null, rate_limits_available: false, rate_limits: null },
      undefined,
    );

    expect(probe.absence).toBe("unsupported");
    expect(probe.fiveHour).toBeNull();
  });

  it("reports limits that are available but empty as unavailable", () => {
    const probe = readSubscriptionUsageResponse(
      { rate_limits_available: true, rate_limits: {} },
      account,
    );

    expect(probe.absence).toBe("unavailable");
    expect(probe.fiveHour).toBeNull();
  });

  it("ignores a window whose utilization is not a usable percentage", () => {
    const probe = readSubscriptionUsageResponse(
      {
        rate_limits_available: true,
        rate_limits: {
          five_hour: { utilization: "lots", resets_at: null },
          seven_day: { utilization: 120, resets_at: null },
        },
      },
      account,
    );

    expect(probe.fiveHour).toBeNull();
    expect(probe.sevenDay).toBeNull();
    expect(probe.absence).toBe("unavailable");
  });

  it("keeps a window that reports no reset time", () => {
    const probe = readSubscriptionUsageResponse(
      { rate_limits_available: true, rate_limits: { five_hour: { utilization: 3 } } },
      account,
    );

    expect(probe.fiveHour).toEqual({ utilization: 3, resetsAt: null });
  });

  it("treats an answer that is not an object as a failure", () => {
    expect(readSubscriptionUsageResponse(undefined, account).absence).toBe("failed");
    expect(readSubscriptionUsageResponse("nope", account).absence).toBe("failed");
  });

  it("prefers the plan the usage answer names over the one from start-up", () => {
    const probe = readSubscriptionUsageResponse(
      { subscription_type: "team", rate_limits_available: true, rate_limits: {} },
      { subscriptionType: "pro" },
    );

    expect(probe.subscriptionType).toBe("team");
  });
});

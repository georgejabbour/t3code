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

    expect(probe.fiveHour).toEqual({
      label: "5h",
      utilization: 12,
      resetsAt: "2026-01-01T05:00:00.000Z",
    });
    expect(probe.sevenDay).toEqual({
      label: "Week",
      utilization: 40,
      resetsAt: "2026-01-07T00:00:00.000Z",
    });
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

  it("reports a plan whose limits are switched off as unavailable, not unsupported", () => {
    // Captured on 20 August 2026 from an account whose organization has turned
    // Claude Code subscription access off. The plan is real and the SDK names
    // it, and it sends no windows at all. Calling that "billed per token"
    // would deny a plan the account has.
    const probe = readSubscriptionUsageResponse(
      { subscription_type: "max", rate_limits_available: true, rate_limits: null },
      { email: "george@flexslot.gg", subscriptionType: "Claude Max" },
    );

    expect(probe.absence).toBe("unavailable");
    expect(probe.subscriptionType).toBe("max");
    expect(probe.email).toBe("george@flexslot.gg");
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

  it("keeps a plan that reports only the long window", () => {
    // The short window carries the number a person feels first, but a plan
    // that reports only a weekly window still has a figure worth showing.
    const probe = readSubscriptionUsageResponse(
      {
        rate_limits_available: true,
        rate_limits: { seven_day: { utilization: 6, resets_at: "2026-01-07T00:00:00.000Z" } },
      },
      account,
    );

    expect(probe.absence).toBeNull();
    expect(probe.fiveHour).toBeNull();
    expect(probe.sevenDay).toEqual({
      label: "Week",
      utilization: 6,
      resetsAt: "2026-01-07T00:00:00.000Z",
    });
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

    expect(probe.fiveHour).toEqual({ label: "5h", utilization: 3, resetsAt: null });
  });

  it("reads a real answer from a Claude Max account", () => {
    // Captured from the SDK on 16 August 2026. The runtime shape carries keys
    // the SDK's own types do not document — `limits`, `spend`, `model_scoped`
    // and several code names — and the windows carry dollar fields. Everything
    // beyond utilization and the reset time is ignored on purpose, so a shape
    // that grows again does not stop the number appearing.
    const probe = readSubscriptionUsageResponse(
      {
        subscription_type: "max",
        rate_limits_available: true,
        rate_limits: {
          five_hour: {
            utilization: 10,
            resets_at: "2026-08-16T17:00:00.137018+00:00",
            limit_dollars: null,
            used_dollars: null,
            remaining_dollars: null,
          },
          seven_day: {
            utilization: 20,
            resets_at: "2026-08-18T15:00:00.137040+00:00",
            limit_dollars: null,
          },
          seven_day_opus: null,
          extra_usage: null,
          limits: [],
          spend: { used: { amount_minor: 0 } },
          model_scoped: [{ display_name: "Fable", utilization: 0, resets_at: null }],
        },
      },
      { email: "georgejabbour3@gmail.com", subscriptionType: "Claude Max" },
    );

    expect(probe.absence).toBeNull();
    expect(probe.fiveHour).toEqual({
      label: "5h",
      utilization: 10,
      resetsAt: "2026-08-16T17:00:00.137018+00:00",
    });
    expect(probe.sevenDay?.utilization).toBe(20);
    expect(probe.email).toBe("georgejabbour3@gmail.com");
    expect(probe.subscriptionType).toBe("max");
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

import type * as CodexSchema from "effect-codex-app-server/schema";
import { describe, expect, it } from "vite-plus/test";

import {
  codexWindowLabel,
  readCodexRateLimits,
  readCodexSubscriptionUsage,
} from "./CodexSubscriptionUsage.ts";

type RateLimits = CodexSchema.V2GetAccountRateLimitsResponse["rateLimits"];
type Account = CodexSchema.V2GetAccountResponse["account"];

const chatgpt = (planType: string): Account =>
  ({ type: "chatgpt", email: "person@example.com", planType }) as Account;

describe("codexWindowLabel", () => {
  it("names a seven-day window the way the panel writes it", () => {
    expect(codexWindowLabel(10_080, "5h")).toBe("Week");
  });

  it("names a five-hour window in hours", () => {
    expect(codexWindowLabel(300, "Week")).toBe("5h");
  });

  it("names a window shorter than an hour in minutes", () => {
    expect(codexWindowLabel(30, "5h")).toBe("30m");
  });

  it("names a window longer than a day, and not a week, in days", () => {
    expect(codexWindowLabel(30 * 24 * 60, "5h")).toBe("30d");
  });

  it("keeps the caller's name when the tool states no duration", () => {
    expect(codexWindowLabel(null, "5h")).toBe("5h");
    expect(codexWindowLabel(undefined, "Week")).toBe("Week");
    expect(codexWindowLabel(0, "5h")).toBe("5h");
  });
});

describe("readCodexRateLimits", () => {
  it("sorts a five-hour primary and a weekly secondary into their own slots", () => {
    const limits = readCodexRateLimits({
      primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1787292955 },
      secondary: { usedPercent: 40, windowDurationMins: 10_080, resetsAt: 1787879755 },
    } as RateLimits);

    expect(limits.fiveHour).toEqual({
      label: "5h",
      utilization: 12,
      resetsAt: "2026-08-21T06:15:55.000Z",
    });
    expect(limits.sevenDay).toEqual({
      label: "Week",
      utilization: 40,
      resetsAt: "2026-08-28T01:15:55.000Z",
    });
  });

  it("puts a weekly primary in the long slot and leaves the short one empty", () => {
    // A ChatGPT Pro 5x account reports exactly this: one seven-day window as
    // its primary, and no secondary at all. Trusting the field name would have
    // drawn a weekly figure under the heading "5h".
    const limits = readCodexRateLimits({
      primary: { usedPercent: 6, windowDurationMins: 10_080, resetsAt: 1787840342 },
      secondary: null,
    } as RateLimits);

    expect(limits.fiveHour).toBeNull();
    expect(limits.sevenDay).toEqual({
      label: "Week",
      utilization: 6,
      resetsAt: "2026-08-27T14:19:02.000Z",
    });
  });

  it("keeps a window the tool reports with no reset time", () => {
    const limits = readCodexRateLimits({
      primary: { usedPercent: 3, windowDurationMins: 300 },
    } as RateLimits);

    expect(limits.fiveHour).toEqual({ label: "5h", utilization: 3, resetsAt: null });
  });

  it("holds a plan over its allowance at the whole window", () => {
    const limits = readCodexRateLimits({
      primary: { usedPercent: 140, windowDurationMins: 300, resetsAt: 1787292955 },
    } as RateLimits);

    expect(limits.fiveHour?.utilization).toBe(100);
  });

  it("reports nothing when the tool sends no limits", () => {
    expect(readCodexRateLimits(undefined)).toEqual({ fiveHour: null, sevenDay: null });
  });
});

describe("readCodexSubscriptionUsage", () => {
  it("reads the plan, the address and the window from a real answer", () => {
    // Captured from `codex app-server` v0.149.0 on 20 August 2026.
    const probe = readCodexSubscriptionUsage(chatgpt("prolite"), {
      limitId: "codex",
      limitName: null,
      primary: { usedPercent: 6, windowDurationMins: 10_080, resetsAt: 1787840342 },
      secondary: null,
      credits: { hasCredits: false, unlimited: false, balance: "0" },
      individualLimit: null,
      spendControlReached: false,
      planType: "prolite",
      rateLimitReachedType: null,
    } as RateLimits);

    expect(probe.absence).toBeNull();
    expect(probe.email).toBe("person@example.com");
    expect(probe.subscriptionType).toBe("ChatGPT Pro 5x");
    expect(probe.sevenDay?.utilization).toBe(6);
    expect(probe.fiveHour).toBeNull();
  });

  it("reports a tool with no account as signed out", () => {
    const probe = readCodexSubscriptionUsage(undefined, undefined);

    expect(probe.absence).toBe("signedOut");
    expect(probe.email).toBeNull();
    expect(probe.subscriptionType).toBeNull();
  });

  it("reports an API key sign-in as having no plan limit", () => {
    const probe = readCodexSubscriptionUsage({ type: "apiKey" } as Account, undefined);

    expect(probe.absence).toBe("unsupported");
    expect(probe.subscriptionType).toBe("OpenAI API key");
  });

  it("reports a signed-in plan that sends no window as unavailable", () => {
    const probe = readCodexSubscriptionUsage(chatgpt("plus"), undefined);

    expect(probe.absence).toBe("unavailable");
    expect(probe.subscriptionType).toBe("ChatGPT Plus");
  });

  it("passes a plan name this build has never seen straight through", () => {
    // OpenAI adds plans. Dropping an unknown one would leave the row nameless
    // for no reason.
    const probe = readCodexSubscriptionUsage(chatgpt("ultra_2027"), undefined);

    expect(probe.subscriptionType).toBe("ultra_2027");
  });
});

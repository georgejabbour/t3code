import type { ProviderInstanceConfig } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { mergeProviderInstanceEnvironment } from "./ProviderInstanceEnvironment.ts";
import { subscriptionDisplayName } from "./SubscriptionUsageService.ts";

const instance = (overrides: Partial<ProviderInstanceConfig> = {}): ProviderInstanceConfig =>
  ({
    driver: "claudeAgent",
    enabled: true,
    ...overrides,
  }) as ProviderInstanceConfig;

describe("the environment a usage probe runs in", () => {
  it("inherits the whole environment when an instance declares none", () => {
    // Handing the probe only the declared variables strips HOME, and without
    // HOME the Claude CLI cannot reach the macOS keychain holding its OAuth
    // credentials. It then reports no account and no plan, and a healthy
    // subscription reads as "No plan limit on this sign-in".
    const environment = mergeProviderInstanceEnvironment(instance().environment);

    expect(environment).toBe(process.env);
    expect(environment.HOME).toBe(process.env.HOME);
  });

  it("adds an instance's own variables on top of the inherited ones", () => {
    const environment = mergeProviderInstanceEnvironment(
      instance({
        environment: [{ name: "ANTHROPIC_LOG", value: "debug", sensitive: false }],
      }).environment,
    );

    expect(environment.ANTHROPIC_LOG).toBe("debug");
    expect(environment.HOME).toBe(process.env.HOME);
  });
});

describe("subscriptionDisplayName", () => {
  it("prefers the name the instance was given", () => {
    expect(
      subscriptionDisplayName({
        instanceId: "claudeAgent",
        configuredName: "Work account",
        email: "george@example.com",
      }),
    ).toBe("Work account");
  });

  it("falls back to the account email, which says more than an instance id", () => {
    expect(
      subscriptionDisplayName({
        instanceId: "claudeAgent",
        configuredName: undefined,
        email: "george@example.com",
      }),
    ).toBe("george@example.com");
  });

  it("uses the instance id only when nothing else is known", () => {
    expect(
      subscriptionDisplayName({
        instanceId: "claudeAgent",
        configuredName: "   ",
        email: null,
      }),
    ).toBe("claudeAgent");
  });
});

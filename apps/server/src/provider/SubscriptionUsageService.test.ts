import { ProviderDriverKind, type ProviderInstanceConfig } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { mergeProviderInstanceEnvironment } from "./ProviderInstanceEnvironment.ts";
import {
  subscriptionDisplayName,
  subscriptionSignInFromKey,
  subscriptionSignInKey,
  subscriptionSignInOf,
} from "./SubscriptionUsageService.ts";

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

describe("the sign-in a usage probe reads", () => {
  const keyOf = (config: ProviderInstanceConfig) =>
    subscriptionSignInKey(subscriptionSignInOf(config));

  it("gives two instances of one account the same key", () => {
    // A person keeps a second Codex instance for a different set of launch
    // arguments, or simply for a name. Both read one ChatGPT sign-in, so one
    // subprocess should answer for both.
    const first = keyOf(
      instance({
        driver: ProviderDriverKind.make("codex"),
        displayName: "Codex",
        config: { binaryPath: "/usr/local/bin/codex", homePath: "", launchArgs: "" },
      }),
    );
    const second = keyOf(
      instance({
        driver: ProviderDriverKind.make("codex"),
        displayName: "Hermes (Codex)",
        accentColor: "#f59e0b",
        config: { binaryPath: "/usr/local/bin/codex", homePath: "", launchArgs: "" },
      }),
    );

    expect(first).toBe(second);
  });

  it("gives two credentials directories different keys", () => {
    // Two Claude sign-ins live side by side, one per config directory. Sharing
    // a key would show one account's numbers under the other's name.
    const personal = keyOf(instance({ config: { binaryPath: "claude", homePath: "~/.claude" } }));
    const work = keyOf(
      instance({ config: { binaryPath: "claude", homePath: "~/.claude-hermes" } }),
    );

    expect(personal).not.toBe(work);
  });

  it("uses the Codex command default when an instance stores only its credentials directory", () => {
    for (const config of [
      { homePath: "~/.codex-second" },
      { binaryPath: "", homePath: "~/.codex-second" },
    ]) {
      const signIn = subscriptionSignInOf(
        instance({ driver: ProviderDriverKind.make("codex"), config }),
      );

      expect(signIn).toMatchObject({
        binaryPath: "codex",
        homePath: "~/.codex-second",
        launchArgs: "",
      });
    }
  });

  it("gives two drivers different keys, whatever else matches", () => {
    const claude = keyOf(
      instance({ driver: ProviderDriverKind.make("claudeAgent"), config: { binaryPath: "" } }),
    );
    const codex = keyOf(
      instance({ driver: ProviderDriverKind.make("codex"), config: { binaryPath: "" } }),
    );

    expect(claude).not.toBe(codex);
  });

  it("ignores the order the settings file happens to list variables in", () => {
    const forward = keyOf(
      instance({
        environment: [
          { name: "A", value: "1", sensitive: false },
          { name: "B", value: "2", sensitive: false },
        ],
      }),
    );
    const reversed = keyOf(
      instance({
        environment: [
          { name: "B", value: "2", sensitive: false },
          { name: "A", value: "1", sensitive: false },
        ],
      }),
    );

    expect(forward).toBe(reversed);
  });

  it("reads the key back into everything a probe needs", () => {
    // The cache hands its lookup nothing but the key, so a key the lookup
    // cannot read leaves the probe with no binary to start. It then spawns
    // nothing, and the list dies with it.
    const signIn = subscriptionSignInOf(
      instance({
        driver: ProviderDriverKind.make("codex"),
        environment: [{ name: "CODEX_LOG", value: "debug", sensitive: false }],
        config: {
          binaryPath: "/usr/local/bin/codex",
          homePath: "~/.codex-work",
          launchArgs: "--flag",
        },
      }),
    );

    expect(subscriptionSignInFromKey(subscriptionSignInKey(signIn))).toEqual({
      driver: ProviderDriverKind.make("codex"),
      binaryPath: "/usr/local/bin/codex",
      homePath: "~/.codex-work",
      launchArgs: "--flag",
      environment: [{ name: "CODEX_LOG", value: "debug", sensitive: false }],
    });
  });

  it("changes the key when a variable's value changes", () => {
    const before = keyOf(instance({ environment: [{ name: "A", value: "1", sensitive: false }] }));
    const after = keyOf(instance({ environment: [{ name: "A", value: "2", sensitive: false }] }));

    expect(before).not.toBe(after);
  });
});

/**
 * SubscriptionUsageService - collect usage for every connected subscription.
 *
 * One provider instance is one sign-in, because each instance points at its
 * own credentials directory. A Claude instance is a claude.ai plan and a Codex
 * instance is a ChatGPT plan. This service asks each of them in turn and hands
 * the answers to the selector.
 *
 * ## What the list holds
 *
 * Every instance whose driver can carry a subscription, in the order settings
 * list them, whether or not it is turned on. An instance that is turned off is
 * listed with `absence: "disabled"` and nothing is asked of it. That is
 * deliberate: a person who adds a subscription and later turns it off should
 * still see it, and should be able to see why it reports no number. Hiding it
 * made a subscription look as though it had never been added.
 *
 * ## What it costs
 *
 * Asking costs a short-lived subprocess per sign-in, so answers are held for
 * {@link SUBSCRIPTION_USAGE_CACHE_TTL}. The cache key is the sign-in, not the
 * instance, so two instances that point at one account cost one subprocess
 * between them. The selector reads the held answers on open, and a person who
 * wants a fresh number asks for one.
 *
 * This fork keeps its additions in new files, so an upstream change rarely
 * conflicts with them.
 *
 * @module SubscriptionUsageService
 */
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderInstanceConfig,
  type SubscriptionUsage,
  type SubscriptionUsageList,
} from "@t3tools/contracts";

import * as BackgroundPolicy from "../background/BackgroundPolicy.ts";
import { forkParked } from "../serverActivation.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { probeClaudeSubscriptionUsage } from "./ClaudeSubscriptionUsage.ts";
import { probeCodexSubscriptionUsage } from "./CodexSubscriptionUsage.ts";
import { mergeProviderInstanceEnvironment } from "./ProviderInstanceEnvironment.ts";
import { SubscriptionUsageHistoryStore } from "./SubscriptionUsageHistoryStore.ts";
import type { SubscriptionUsageProbe } from "./subscriptionUsageProbe.ts";

/** How long one sign-in's answer is reused before it is asked again. */
export const SUBSCRIPTION_USAGE_CACHE_TTL = Duration.minutes(5);

const CLAUDE_DRIVER = ProviderDriverKind.make("claudeAgent");
const CODEX_DRIVER = ProviderDriverKind.make("codex");

/**
 * Drivers that sign in to a paid plan rather than billing per token.
 *
 * Cursor, Grok and OpenCode are left out on purpose. None of them reports a
 * plan window T3 Code can read, so a row for one would show a name and no
 * number every time, which teaches a reader to ignore the panel.
 */
const SUBSCRIPTION_DRIVERS: ReadonlySet<string> = new Set([CLAUDE_DRIVER, CODEX_DRIVER]);

const SUBSCRIPTION_USAGE_CACHE_CAPACITY = 64;

/**
 * Turn a sign-in's declared environment into one a subprocess accepts.
 *
 * The shared helper merges onto `process.env`, and that merge is the whole
 * point. Handing a probe only the declared variables strips `HOME`, and
 * without `HOME` the Claude CLI cannot reach the macOS login keychain that
 * holds its OAuth credentials. It then starts signed out, reports no account
 * and no plan, and the selector shows an unread subscription that is perfectly
 * healthy. An instance that declares no variables of its own must inherit the
 * whole environment, not an empty one.
 */
function environmentForSignIn(declared: ProviderInstanceConfig["environment"]): NodeJS.ProcessEnv {
  return mergeProviderInstanceEnvironment(declared);
}

/**
 * Name shown for a subscription.
 *
 * The instance's own display name wins. Without one the account's email says
 * more than the instance id does, and the id is the last resort.
 */
export function subscriptionDisplayName(input: {
  readonly instanceId: string;
  readonly configuredName: string | undefined;
  readonly email: string | null;
}): string {
  const configured = input.configuredName?.trim();
  if (configured && configured.length > 0) {
    return configured;
  }
  const email = input.email?.trim();
  return email && email.length > 0 ? email : input.instanceId;
}

/**
 * Everything a probe needs, and nothing that only names an instance.
 *
 * A probe reads a binary, a credentials directory and an environment. It never
 * reads a display name or an accent colour, so two instances that agree on
 * these four fields always report the same numbers.
 */
export interface SubscriptionSignIn {
  readonly driver: string;
  readonly binaryPath: string;
  readonly homePath: string;
  readonly launchArgs: string;
  readonly environment: ProviderInstanceConfig["environment"] | null;
}

/**
 * The sign-in an instance reads.
 *
 * Exported for its own test. A key that is too loose would show one account's
 * numbers under another account's name; a key that is too tight would start a
 * second subprocess to learn what the first one already knows.
 */
export function subscriptionSignInOf(config: ProviderInstanceConfig): SubscriptionSignIn {
  const settings = (config.config ?? {}) as Record<string, unknown>;
  const readString = (name: string): string => {
    const value = settings[name];
    return typeof value === "string" ? value.trim() : "";
  };
  return {
    driver: config.driver,
    binaryPath: readString("binaryPath"),
    homePath: readString("homePath"),
    launchArgs: readString("launchArgs"),
    environment: config.environment ?? null,
  };
}

/**
 * One sign-in written as a cache key.
 *
 * The key is also the whole input a probe needs, and
 * {@link subscriptionSignInFromKey} reads it straight back. A cache hands its
 * lookup nothing but the key, so anything the probe needs has to survive the
 * round trip.
 *
 * The fields are written in a fixed order, and the variables are sorted by
 * name, so two instances that differ only in how their settings file happens
 * to order its keys still share one entry.
 *
 * The key carries the value of every declared variable, and one of those can
 * be a credential. It stays in memory, in the cache, and it is never written
 * to a log, a span or a file. Keep it that way.
 */
export function subscriptionSignInKey(signIn: SubscriptionSignIn): string {
  return JSON.stringify({
    driver: signIn.driver,
    binaryPath: signIn.binaryPath,
    homePath: signIn.homePath,
    launchArgs: signIn.launchArgs,
    environment:
      signIn.environment === null || signIn.environment === undefined
        ? null
        : [...signIn.environment]
            .map((variable) => ({ name: variable.name, value: variable.value }))
            .sort((left, right) => left.name.localeCompare(right.name)),
  });
}

/** Read a key back into the sign-in it was written from. */
export function subscriptionSignInFromKey(key: string): SubscriptionSignIn {
  const parsed = JSON.parse(key) as {
    readonly driver: string;
    readonly binaryPath: string;
    readonly homePath: string;
    readonly launchArgs: string;
    readonly environment: ReadonlyArray<{ readonly name: string; readonly value: string }> | null;
  };
  return {
    driver: parsed.driver,
    binaryPath: parsed.binaryPath,
    homePath: parsed.homePath,
    launchArgs: parsed.launchArgs,
    environment:
      parsed.environment === null
        ? null
        : parsed.environment.map((variable) => ({ ...variable, sensitive: false })),
  };
}

export class SubscriptionUsageService extends Context.Service<
  SubscriptionUsageService,
  {
    /**
     * Usage for every subscription instance, newest answer first held for
     * {@link SUBSCRIPTION_USAGE_CACHE_TTL}. Never fails: an instance that
     * cannot answer appears with its `absence` set.
     */
    readonly getSubscriptionUsage: Effect.Effect<SubscriptionUsageList>;
    /** Drop every held answer, so the next read asks each sign-in again. */
    readonly refresh: Effect.Effect<void>;
    /**
     * Take one reading of every subscription and fold it into the record of
     * window peaks. Runs on a timer, and never fails.
     */
    readonly sampleForHistory: Effect.Effect<void>;
  }
>()("t3/provider/SubscriptionUsageService") {}

/** How often a reading is taken for the record of window peaks. */
export const SUBSCRIPTION_SAMPLE_INTERVAL = Duration.minutes(30);

/** Stands in for a collection time when an instance never answered. */
const NEVER_COLLECTED_AT = "1970-01-01T00:00:00.000Z";

/** An instance nothing could be read from. */
const COULD_NOT_READ: SubscriptionUsageProbe = {
  email: null,
  subscriptionType: null,
  fiveHour: null,
  sevenDay: null,
  absence: "failed",
};

export const make = Effect.gen(function* () {
  const serverSettings = yield* ServerSettingsService;
  const historyStore = yield* SubscriptionUsageHistoryStore;
  const backgroundPolicy = yield* BackgroundPolicy.BackgroundPolicy;
  // Resolved once here so the cache's lookup carries no service requirement.
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  /** Ask one sign-in, whichever tool it belongs to. */
  const probe = Effect.fn("SubscriptionUsageService.probe")(function* (signIn: SubscriptionSignIn) {
    const environment = environmentForSignIn(signIn.environment ?? undefined);
    if (signIn.driver === CLAUDE_DRIVER) {
      return yield* probeClaudeSubscriptionUsage(
        { binaryPath: signIn.binaryPath, homePath: signIn.homePath },
        environment,
      );
    }
    // The tool needs a working directory that exists. The server's own is the
    // one directory guaranteed to, and no file in it is read.
    return yield* probeCodexSubscriptionUsage(
      {
        binaryPath: signIn.binaryPath,
        homePath: signIn.homePath,
        launchArgs: signIn.launchArgs,
      },
      environment,
      process.cwd(),
    );
  });

  // Keyed by sign-in, not by instance, so two instances that read one account
  // cost one subprocess between them.
  const cache = yield* Cache.make<string, SubscriptionUsageProbe>({
    capacity: SUBSCRIPTION_USAGE_CACHE_CAPACITY,
    timeToLive: SUBSCRIPTION_USAGE_CACHE_TTL,
    lookup: (key: string) =>
      probe(subscriptionSignInFromKey(key)).pipe(
        Effect.provideService(Path.Path, path),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      ),
  });

  /**
   * Instances a subscription can be read from, in the order settings list
   * them, so the selector does not reorder itself as usage changes.
   */
  const subscriptionInstances = Effect.gen(function* () {
    const settings = yield* serverSettings.getSettings;
    return Object.entries(settings.providerInstances ?? {}).filter(([, config]) =>
      SUBSCRIPTION_DRIVERS.has(config.driver),
    );
  }).pipe(Effect.orElseSucceed(() => []));

  /** Fill one row from an answer, or from the reason there is none. */
  const rowFor = (input: {
    readonly instanceId: string;
    readonly config: ProviderInstanceConfig;
    readonly result: SubscriptionUsageProbe;
    readonly collectedAt: string;
  }): SubscriptionUsage =>
    ({
      instanceId: ProviderInstanceId.make(input.instanceId),
      driver: input.config.driver,
      enabled: input.config.enabled !== false,
      displayName: subscriptionDisplayName({
        instanceId: input.instanceId,
        configuredName: input.config.displayName,
        email: input.result.email,
      }),
      accentColor: input.config.accentColor ?? null,
      email: input.result.email,
      subscriptionType: input.result.subscriptionType,
      fiveHour: input.result.fiveHour,
      sevenDay: input.result.sevenDay,
      absence: input.result.absence,
      collectedAt: input.collectedAt,
    }) satisfies SubscriptionUsage;

  const getSubscriptionUsage: SubscriptionUsageService["Service"]["getSubscriptionUsage"] =
    Effect.gen(function* () {
      const instances = yield* subscriptionInstances;
      const collectedAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso));

      const subscriptions = yield* Effect.forEach(
        instances,
        ([instanceId, config]) => {
          // Nothing is asked of an instance that is turned off. It still gets
          // a row, so turning one off never makes it disappear.
          if (config.enabled === false) {
            return Effect.succeed(
              rowFor({
                instanceId,
                config,
                result: {
                  email: null,
                  subscriptionType: null,
                  fiveHour: null,
                  sevenDay: null,
                  absence: "disabled",
                },
                collectedAt,
              }),
            );
          }

          // The key carries the sign-in, so an edited instance is asked again
          // rather than answering from the entry its old settings filled.
          const signIn = subscriptionSignInOf(config);
          return Cache.get(cache, subscriptionSignInKey(signIn)).pipe(
            Effect.map((result) => rowFor({ instanceId, config, result, collectedAt })),
            Effect.orElseSucceed(() =>
              rowFor({
                instanceId,
                config,
                result: COULD_NOT_READ,
                collectedAt: NEVER_COLLECTED_AT,
              }),
            ),
          );
        },
        { concurrency: 4 },
      );
      return { subscriptions } satisfies SubscriptionUsageList;
    });

  /**
   * Take a reading and fold it into the record of window peaks.
   *
   * Skipped while the machine has no reason to be doing background work, so a
   * laptop asleep on battery does not spawn a provider process every half
   * hour. A skipped sample leaves a gap in the record rather than a wrong
   * number: peaks only ever climb, so the next reading still catches how high
   * the window went.
   */
  const sampleForHistory: SubscriptionUsageService["Service"]["sampleForHistory"] = Effect.gen(
    function* () {
      const shouldRun = yield* backgroundPolicy.shouldRunScopeWork({ type: "provider-status" });
      if (!shouldRun) {
        return;
      }

      const { subscriptions } = yield* getSubscriptionUsage;
      if (subscriptions.length === 0) {
        return;
      }

      const sampledAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso));
      yield* historyStore.record({ subscriptions, sampledAt });
    },
  ).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("could not sample subscription usage for the record", {
        cause: String(cause),
      }),
    ),
  );

  // Sample on a timer for as long as the server runs. Parked until the server
  // finishes starting, so a probe never competes with start-up, and scoped to
  // this layer so it stops with it.
  yield* forkParked(
    sampleForHistory.pipe(Effect.repeat(Schedule.spaced(SUBSCRIPTION_SAMPLE_INTERVAL))),
  );

  return SubscriptionUsageService.of({
    getSubscriptionUsage,
    refresh: Cache.invalidateAll(cache),
    sampleForHistory,
  });
});

export const layer = Layer.effect(SubscriptionUsageService, make);

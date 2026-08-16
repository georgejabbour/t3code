/**
 * SubscriptionUsageService - collect usage for every connected Claude
 * subscription.
 *
 * One Claude provider instance is one claude.ai subscription, because each
 * instance points at its own credentials directory. This service asks each
 * enabled instance in turn and hands the answers to the selector.
 *
 * Asking costs a short-lived Claude subprocess per instance, so answers are
 * held for {@link SUBSCRIPTION_USAGE_CACHE_TTL}. The selector reads them on
 * open, and a person who wants a fresh number asks for one.
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
import * as Schema from "effect/Schema";

import {
  ClaudeSettings,
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
import { mergeProviderInstanceEnvironment } from "./ProviderInstanceEnvironment.ts";
import { SubscriptionUsageHistoryStore } from "./SubscriptionUsageHistoryStore.ts";

/** How long one instance's answer is reused before it is asked again. */
export const SUBSCRIPTION_USAGE_CACHE_TTL = Duration.minutes(5);

const CLAUDE_DRIVER = ProviderDriverKind.make("claudeAgent");
const SUBSCRIPTION_USAGE_CACHE_CAPACITY = 64;

const decodeClaudeSettings = Schema.decodeUnknownSync(ClaudeSettings);

/**
 * Read an instance's configuration as Claude settings.
 *
 * An envelope this fork cannot read is skipped rather than failing the whole
 * list, because one broken instance must not hide the others.
 */
function claudeSettingsForInstance(config: ProviderInstanceConfig): ClaudeSettings | null {
  try {
    return decodeClaudeSettings(config.config ?? {});
  } catch {
    return null;
  }
}

/**
 * Turn an instance's declared environment into one a subprocess accepts.
 *
 * The shared helper merges onto `process.env`, and that merge is the whole
 * point. Handing the probe only the declared variables strips `HOME`, and
 * without `HOME` the Claude CLI cannot reach the macOS login keychain that
 * holds its OAuth credentials. It then starts signed out, reports no account
 * and no plan, and the selector shows "No plan limit on this sign-in" for a
 * subscription that is perfectly healthy. An instance that declares no
 * variables of its own must inherit the whole environment, not an empty one.
 */
function environmentForInstance(config: ProviderInstanceConfig): NodeJS.ProcessEnv {
  return mergeProviderInstanceEnvironment(config.environment);
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

export class SubscriptionUsageService extends Context.Service<
  SubscriptionUsageService,
  {
    /**
     * Usage for every enabled Claude instance, newest answer first held for
     * {@link SUBSCRIPTION_USAGE_CACHE_TTL}. Never fails: an instance that
     * cannot answer appears with its `absence` set.
     */
    readonly getSubscriptionUsage: Effect.Effect<SubscriptionUsageList>;
    /** Drop every held answer, so the next read asks each instance again. */
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

export const make = Effect.gen(function* () {
  const serverSettings = yield* ServerSettingsService;
  const historyStore = yield* SubscriptionUsageHistoryStore;
  const backgroundPolicy = yield* BackgroundPolicy.BackgroundPolicy;
  // Resolved once here so the cache's lookup carries no service requirement.
  const path = yield* Path.Path;

  const probe = Effect.fn("SubscriptionUsageService.probe")(function* (input: {
    readonly instanceId: ProviderInstanceId;
    readonly config: ProviderInstanceConfig;
  }) {
    const collectedAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso));
    const settings = claudeSettingsForInstance(input.config);
    const base = {
      instanceId: input.instanceId,
      accentColor: input.config.accentColor ?? null,
      collectedAt,
    } as const;

    if (settings === null) {
      return {
        ...base,
        displayName: subscriptionDisplayName({
          instanceId: input.instanceId,
          configuredName: input.config.displayName,
          email: null,
        }),
        email: null,
        subscriptionType: null,
        fiveHour: null,
        sevenDay: null,
        absence: "failed" as const,
      } satisfies SubscriptionUsage;
    }

    const result = yield* probeClaudeSubscriptionUsage(
      settings,
      environmentForInstance(input.config),
    );
    return {
      ...base,
      displayName: subscriptionDisplayName({
        instanceId: input.instanceId,
        configuredName: input.config.displayName,
        email: result.email,
      }),
      email: result.email,
      subscriptionType: result.subscriptionType,
      fiveHour: result.fiveHour,
      sevenDay: result.sevenDay,
      absence: result.absence,
    } satisfies SubscriptionUsage;
  });

  const cache = yield* Cache.make<string, SubscriptionUsage>({
    capacity: SUBSCRIPTION_USAGE_CACHE_CAPACITY,
    timeToLive: SUBSCRIPTION_USAGE_CACHE_TTL,
    lookup: (key: string) => {
      const parsed = JSON.parse(key) as {
        readonly instanceId: string;
        readonly config: ProviderInstanceConfig;
      };
      return probe({
        instanceId: ProviderInstanceId.make(parsed.instanceId),
        config: parsed.config,
      }).pipe(Effect.provideService(Path.Path, path));
    },
  });

  /**
   * Instances a subscription can be read from, in the order settings list
   * them, so the selector does not reorder itself as usage changes.
   */
  const claudeInstances = Effect.gen(function* () {
    const settings = yield* serverSettings.getSettings;
    return Object.entries(settings.providerInstances ?? {}).filter(
      ([, config]) => config.driver === CLAUDE_DRIVER && config.enabled !== false,
    );
  }).pipe(Effect.orElseSucceed(() => []));

  const getSubscriptionUsage: SubscriptionUsageService["Service"]["getSubscriptionUsage"] =
    Effect.gen(function* () {
      const instances = yield* claudeInstances;
      // The key carries the configuration, so an edited instance is asked
      // again rather than answering from the entry its old settings filled.
      const subscriptions = yield* Effect.forEach(
        instances,
        ([instanceId, config]) =>
          Cache.get(cache, JSON.stringify({ instanceId, config })).pipe(
            Effect.orElseSucceed(
              () =>
                ({
                  instanceId: ProviderInstanceId.make(instanceId),
                  displayName: instanceId,
                  accentColor: config.accentColor ?? null,
                  email: null,
                  subscriptionType: null,
                  fiveHour: null,
                  sevenDay: null,
                  absence: "failed",
                  collectedAt: NEVER_COLLECTED_AT,
                }) satisfies SubscriptionUsage,
            ),
          ),
        { concurrency: 4 },
      );
      return { subscriptions } satisfies SubscriptionUsageList;
    });

  /**
   * Take a reading and fold it into the record of window peaks.
   *
   * Skipped while the machine has no reason to be doing background work, so a
   * laptop asleep on battery does not spawn a Claude process every half hour.
   * A skipped sample leaves a gap in the record rather than a wrong number:
   * peaks only ever climb, so the next reading still catches how high the
   * window went.
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

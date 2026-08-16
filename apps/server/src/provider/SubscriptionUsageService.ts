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
import * as Schema from "effect/Schema";

import {
  ClaudeSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderInstanceConfig,
  type SubscriptionUsage,
  type SubscriptionUsageList,
} from "@t3tools/contracts";

import { ServerSettingsService } from "../serverSettings.ts";
import { probeClaudeSubscriptionUsage } from "./ClaudeSubscriptionUsage.ts";

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

/** Turn an instance's declared environment into one a subprocess accepts. */
function environmentForInstance(config: ProviderInstanceConfig): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const variable of config.environment ?? []) {
    environment[variable.name] = variable.value;
  }
  return environment;
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
  }
>()("t3/provider/SubscriptionUsageService") {}

/** Stands in for a collection time when an instance never answered. */
const NEVER_COLLECTED_AT = "1970-01-01T00:00:00.000Z";

export const make = Effect.gen(function* () {
  const serverSettings = yield* ServerSettingsService;
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

  return SubscriptionUsageService.of({
    getSubscriptionUsage,
    refresh: Cache.invalidateAll(cache),
  });
});

export const layer = Layer.effect(SubscriptionUsageService, make);

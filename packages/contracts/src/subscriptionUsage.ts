/**
 * subscriptionUsage - how much of each connected Claude subscription is left.
 *
 * A Claude subscription is a claude.ai plan the CLI signs in to. T3 Code keeps
 * one provider instance per subscription, and each instance points at its own
 * credentials directory, so several subscriptions can be connected at once.
 *
 * The Claude Agent SDK reports how much of a plan's rate-limit window has been
 * used. This module carries that report to the client, which shows what is
 * left and lets a person pick the subscription to work on.
 *
 * These shapes live in their own module on purpose. This fork keeps its
 * additions in new files so an upstream change rarely conflicts with them.
 *
 * @module subscriptionUsage
 */
import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

/**
 * One rate-limit window of a plan.
 *
 * `utilization` is the percentage of the window already spent, 0 to 100, as
 * the SDK reports it. The client subtracts it from 100 to show what is left.
 */
export const SubscriptionUsageWindow = Schema.Struct({
  utilization: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
  resetsAt: Schema.NullOr(IsoDateTime),
});
export type SubscriptionUsageWindow = typeof SubscriptionUsageWindow.Type;

/**
 * Why a subscription reports no usage.
 *
 * - `unsupported`: the instance authenticates with an API key, Bedrock or
 *   Vertex, where a claude.ai plan limit does not apply.
 * - `unavailable`: the SDK was asked and answered that limits are not
 *   available, which includes a sign-in whose scope omits the profile.
 * - `failed`: the request itself did not finish.
 */
export const SubscriptionUsageAbsence = Schema.Literals(["unsupported", "unavailable", "failed"]);
export type SubscriptionUsageAbsence = typeof SubscriptionUsageAbsence.Type;

/**
 * What is known about one connected subscription.
 *
 * `fiveHour` is the window a person feels day to day, and it is the one the
 * selector shows. `sevenDay` is carried so a later screen can show it without
 * another round trip.
 */
export const SubscriptionUsage = Schema.Struct({
  instanceId: ProviderInstanceId,
  /** Name shown for the instance, already resolved from its settings. */
  displayName: TrimmedNonEmptyString,
  /** Colour the instance carries in settings, for the dot beside its name. */
  accentColor: Schema.NullOr(TrimmedNonEmptyString),
  /** Account the instance is signed in as, when the SDK reports one. */
  email: Schema.NullOr(TrimmedNonEmptyString),
  /** Plan name the SDK reports, such as "pro" or "max". */
  subscriptionType: Schema.NullOr(TrimmedNonEmptyString),
  fiveHour: Schema.NullOr(SubscriptionUsageWindow),
  sevenDay: Schema.NullOr(SubscriptionUsageWindow),
  /** Set when no window is known, and null when `fiveHour` is present. */
  absence: Schema.NullOr(SubscriptionUsageAbsence),
  /** When this report was collected. */
  collectedAt: IsoDateTime,
});
export type SubscriptionUsage = typeof SubscriptionUsage.Type;

/** Every connected subscription, in the order the settings list them. */
export const SubscriptionUsageList = Schema.Struct({
  subscriptions: Schema.Array(SubscriptionUsage),
});
export type SubscriptionUsageList = typeof SubscriptionUsageList.Type;

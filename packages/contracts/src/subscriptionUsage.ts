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

/** Which rate-limit window a record belongs to. */
export const SubscriptionWindowKind = Schema.Literals(["fiveHour", "sevenDay"]);
export type SubscriptionWindowKind = typeof SubscriptionWindowKind.Type;

/**
 * The highest a single rate-limit window reached before it reset.
 *
 * Utilization only climbs inside a window and returns to zero when the window
 * resets, so one number per window says everything about it. That makes the
 * record small: a row per window rather than a reading every few minutes.
 *
 * `resetsAt` is the identity of the window. The provider gives each window an
 * exact reset time, and two samples that name the same reset time are looking
 * at the same window.
 */
export const SubscriptionWindowPeak = Schema.Struct({
  instanceId: ProviderInstanceId,
  window: SubscriptionWindowKind,
  resetsAt: IsoDateTime,
  /** Highest utilization seen in this window, 0 to 100. */
  peakUtilization: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
  firstSampledAt: IsoDateTime,
  lastSampledAt: IsoDateTime,
  /** How many samples landed in this window, so a lone reading is visible. */
  sampleCount: Schema.Int.check(Schema.isGreaterThan(0)),
});
export type SubscriptionWindowPeak = typeof SubscriptionWindowPeak.Type;

/** Every window recorded so far, oldest reset first. */
export const SubscriptionUsageHistory = Schema.Struct({
  peaks: Schema.Array(SubscriptionWindowPeak),
});
export type SubscriptionUsageHistory = typeof SubscriptionUsageHistory.Type;

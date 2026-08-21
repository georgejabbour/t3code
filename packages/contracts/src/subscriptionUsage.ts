/**
 * subscriptionUsage - how much of each connected subscription is left.
 *
 * A subscription is a paid plan that a provider command-line tool signs in to:
 * a claude.ai plan behind the Claude CLI, or a ChatGPT plan behind the Codex
 * CLI. T3 Code keeps one provider instance per sign-in, and each instance
 * points at its own credentials directory, so several plans can be connected
 * at the same time.
 *
 * Both tools report how much of a plan's rate-limit window has been used. This
 * module carries that report to the client, which shows what is left and lets
 * a person pick the subscription to work on.
 *
 * These shapes live in their own module on purpose. This fork keeps its
 * additions in new files so an upstream change rarely conflicts with them.
 *
 * @module subscriptionUsage
 */
import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";

/**
 * One rate-limit window of a plan.
 *
 * `utilization` is the percentage of the window already spent, 0 to 100, as
 * the provider reports it. The client subtracts it from 100 to show what is
 * left.
 *
 * `label` is the short name the client draws beside the number, such as "5h"
 * or "Week". The server writes it because only the server knows how long the
 * window really is: Claude names its two windows, while Codex states a
 * duration in minutes that differs between plans.
 */
export const SubscriptionUsageWindow = Schema.Struct({
  label: TrimmedNonEmptyString,
  utilization: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
  resetsAt: Schema.NullOr(IsoDateTime),
});
export type SubscriptionUsageWindow = typeof SubscriptionUsageWindow.Type;

/**
 * Why a subscription reports no usage.
 *
 * - `disabled`: the instance is turned off in settings, so nothing was asked
 *   of it. It is still listed, because a person who added a subscription
 *   should keep seeing it after turning it off.
 * - `signedOut`: the tool started and reported no account at all.
 * - `unsupported`: the instance authenticates with an API key, Bedrock or
 *   Vertex, where a plan limit does not apply.
 * - `unavailable`: the tool was asked and answered that limits are not
 *   available. A sign-in whose scope omits the profile lands here, and so does
 *   an account whose organization has switched plan access off.
 * - `failed`: the request itself did not finish.
 */
export const SubscriptionUsageAbsence = Schema.Literals([
  "disabled",
  "signedOut",
  "unsupported",
  "unavailable",
  "failed",
]);
export type SubscriptionUsageAbsence = typeof SubscriptionUsageAbsence.Type;

/**
 * What is known about one connected subscription.
 *
 * A plan has at most two rate-limit windows, a short one and a long one, and
 * the two fields below are those two slots. `fiveHour` holds the short window,
 * the one a person feels within a sitting. `sevenDay` holds the long window,
 * the one that decides how the rest of the week goes. The field names describe
 * Claude's two windows, which is where this fork started; Codex states its
 * windows as a duration in minutes instead, and the server sorts each one into
 * the matching slot. Each window carries its own `label`, so a slot never has
 * to claim a length it does not have. The names stay as they are because the
 * record of past windows on disk is keyed by them.
 */
export const SubscriptionUsage = Schema.Struct({
  instanceId: ProviderInstanceId,
  /** Driver behind the instance, so the client can draw the right mark. */
  driver: ProviderDriverKind,
  /** False while the instance is turned off in settings. */
  enabled: Schema.Boolean,
  /** Name shown for the instance, already resolved from its settings. */
  displayName: TrimmedNonEmptyString,
  /** Colour the instance carries in settings, for the dot beside its name. */
  accentColor: Schema.NullOr(TrimmedNonEmptyString),
  /** Account the instance is signed in as, when the tool reports one. */
  email: Schema.NullOr(TrimmedNonEmptyString),
  /** Plan name the tool reports, such as "pro", "max" or "ChatGPT Pro". */
  subscriptionType: Schema.NullOr(TrimmedNonEmptyString),
  /** The short window, or null when the plan reports none. */
  fiveHour: Schema.NullOr(SubscriptionUsageWindow),
  /** The long window, or null when the plan reports none. */
  sevenDay: Schema.NullOr(SubscriptionUsageWindow),
  /** Set when no window is known, and null when a window is present. */
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

/**
 * Which of the two window slots a record belongs to.
 *
 * `fiveHour` is the short window and `sevenDay` is the long one. See
 * {@link SubscriptionUsage} for why the names stayed.
 */
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

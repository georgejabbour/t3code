/** Quota window peaks. Legacy records remain separate from identified accounts. */
import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

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
  /** Native window ID. Older records use fiveHour or sevenDay. */
  window: TrimmedNonEmptyString,
  /** Omitted on records written before account identity was available. */
  accountKey: Schema.optional(TrimmedNonEmptyString),
  label: Schema.optional(TrimmedNonEmptyString),
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

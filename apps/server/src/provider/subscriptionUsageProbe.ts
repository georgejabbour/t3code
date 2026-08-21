/**
 * subscriptionUsageProbe - what one sign-in reported, before it reaches a row.
 *
 * Two probes fill this shape: the Claude one in
 * {@link ./ClaudeSubscriptionUsage.ts} and the Codex one in
 * {@link ./CodexSubscriptionUsage.ts}. Keeping the shape in its own module
 * lets {@link ./SubscriptionUsageService.ts} treat both the same way and turn
 * either into a row the selector draws.
 *
 * This fork keeps its additions in new files, so an upstream change rarely
 * conflicts with them.
 *
 * @module subscriptionUsageProbe
 */
import type { SubscriptionUsageAbsence, SubscriptionUsageWindow } from "@t3tools/contracts";

/** What one sign-in reported, in this fork's own shape. */
export interface SubscriptionUsageProbe {
  readonly email: string | null;
  readonly subscriptionType: string | null;
  /** The short window, or null when the plan reports none. */
  readonly fiveHour: SubscriptionUsageWindow | null;
  /** The long window, or null when the plan reports none. */
  readonly sevenDay: SubscriptionUsageWindow | null;
  /** Why there is no window, or null when there is one. */
  readonly absence: SubscriptionUsageAbsence | null;
}

/**
 * The plan name shown under a ChatGPT subscription's row.
 *
 * Shorter than the label the provider settings screen shows, because the row
 * already says which provider it belongs to. "ChatGPT Pro 5x Subscription"
 * there becomes "ChatGPT Pro 5x" here.
 *
 * An unknown value is passed through rather than dropped, so a plan OpenAI
 * adds after this build shipped still names itself.
 */
export function codexPlanLabel(planType: string | null | undefined): string | null {
  if (planType === null || planType === undefined) {
    return null;
  }
  switch (planType) {
    case "free":
      return "ChatGPT Free";
    case "go":
      return "ChatGPT Go";
    case "plus":
      return "ChatGPT Plus";
    case "pro":
      return "ChatGPT Pro 20x";
    case "prolite":
      return "ChatGPT Pro 5x";
    case "team":
      return "ChatGPT Team";
    case "self_serve_business_usage_based":
    case "business":
      return "ChatGPT Business";
    case "enterprise_cbp_usage_based":
    case "enterprise":
      return "ChatGPT Enterprise";
    case "edu":
      return "ChatGPT Edu";
    case "unknown":
      return "ChatGPT";
    default:
      return planType;
  }
}

/**
 * ClaudeSubscriptionUsage - read how much of a Claude plan is left.
 *
 * Each Claude provider instance points at its own credentials directory, so a
 * machine can hold several claude.ai subscriptions at once. This module asks
 * one instance how much of its rate-limit window it has spent, so the
 * subscription selector can show what is left.
 *
 * ## The experimental method
 *
 * The Claude Agent SDK exposes this behind a method whose own name says not to
 * rely on it:
 *
 * ```
 * usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()
 * ```
 *
 * Its documentation states the API may change or be removed in any release,
 * and that the name will change once it settles. This fork rebases onto
 * nightly builds, so that rename will arrive without warning.
 *
 * Everything that touches the method is therefore in this one file, and the
 * call is feature-detected rather than typed against. When the method is gone,
 * the probe reports `unavailable` and the selector shows the subscription with
 * no percentage. It never throws, and nothing else in the fork has to know the
 * method exists.
 *
 * @module ClaudeSubscriptionUsage
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Path from "effect/Path";
import { query as claudeQuery, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

import type { ClaudeSettings, SubscriptionUsageWindow } from "@t3tools/contracts";

import type { SubscriptionUsageProbe } from "./subscriptionUsageProbe.ts";
import { resolveClaudeSdkExecutablePath } from "./Drivers/ClaudeExecutable.ts";
import { makeClaudeEnvironment } from "./Drivers/ClaudeHome.ts";
import { buildClaudeCapabilitiesProbeQueryOptions } from "./Layers/ClaudeProvider.ts";

/**
 * The SDK method that returns plan utilization.
 *
 * Held as a string so no type in this fork depends on a name the SDK says it
 * will change. A rename turns the lookup below into `undefined`, which the
 * caller already treats as "usage not reported".
 */
const EXPERIMENTAL_USAGE_METHOD =
  "usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET" as const;

const USAGE_PROBE_TIMEOUT_MS = 25_000;

/** Claude's short window is always five hours, and its long window a week. */
const CLAUDE_SHORT_WINDOW_LABEL = "5h";
const CLAUDE_LONG_WINDOW_LABEL = "Week";

/**
 * What one Claude instance reported.
 *
 * The same shape the Codex probe fills, so the service that lists both treats
 * them alike. The alias is kept because this fork's tests name it.
 */
export type ClaudeSubscriptionUsageProbe = SubscriptionUsageProbe;

const waitForAbortSignal = (signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener("abort", () => resolve(), { once: true });
  });

/** Read a percentage the SDK reports, rejecting anything outside 0 to 100. */
function readUtilization(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null;
}

/**
 * Read one window, and name it.
 *
 * Claude reports exactly two windows and states their length in their own
 * field names, so the label is fixed here rather than derived. Codex states a
 * duration instead, which is why the label travels on the wire at all.
 */
function readWindow(label: string, value: unknown): SubscriptionUsageWindow | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as { utilization?: unknown; resets_at?: unknown };
  const utilization = readUtilization(record.utilization);
  if (utilization === null) {
    return null;
  }
  const resetsAt = typeof record.resets_at === "string" ? record.resets_at : null;
  return { label, utilization, resetsAt };
}

/**
 * Turn the SDK's answer into this fork's shape.
 *
 * Exported so its handling of every shape the SDK documents can be tested
 * without spawning a Claude process.
 */
export function readSubscriptionUsageResponse(
  response: unknown,
  account: { readonly email?: string; readonly subscriptionType?: string } | undefined,
): ClaudeSubscriptionUsageProbe {
  const email = account?.email ?? null;
  const subscriptionType = account?.subscriptionType ?? null;
  const base = { email, subscriptionType } as const;

  if (typeof response !== "object" || response === null) {
    return { ...base, fiveHour: null, sevenDay: null, absence: "failed" };
  }

  const record = response as {
    subscription_type?: unknown;
    rate_limits_available?: unknown;
    rate_limits?: unknown;
  };
  const reportedPlan =
    typeof record.subscription_type === "string" ? record.subscription_type : subscriptionType;

  // The SDK says this is false for an API key, Bedrock and Vertex. None of
  // those bills against a plan, so none of them has a window to report.
  if (record.rate_limits_available !== true) {
    return {
      ...base,
      subscriptionType: reportedPlan,
      fiveHour: null,
      sevenDay: null,
      absence: "unsupported",
    };
  }

  // Limits apply to this sign-in, and the SDK still sent none. A sign-in whose
  // scope omits the profile lands here, and so does an account whose
  // organization has switched plan access off: the plan is named, the windows
  // are not. Calling that "unsupported" would deny a plan the account has.
  if (record.rate_limits === null || record.rate_limits === undefined) {
    return {
      ...base,
      subscriptionType: reportedPlan,
      fiveHour: null,
      sevenDay: null,
      absence: "unavailable",
    };
  }

  const limits = record.rate_limits as { five_hour?: unknown; seven_day?: unknown } | undefined;
  const fiveHour = readWindow(CLAUDE_SHORT_WINDOW_LABEL, limits?.five_hour);
  const sevenDay = readWindow(CLAUDE_LONG_WINDOW_LABEL, limits?.seven_day);

  return {
    ...base,
    subscriptionType: reportedPlan,
    fiveHour,
    sevenDay,
    absence: fiveHour === null && sevenDay === null ? "unavailable" : null,
  };
}

/**
 * Ask one Claude instance how much of its plan is left.
 *
 * Spawns the same never-yielding session the capabilities probe uses, so the
 * subprocess finishes its local start-up and answers, and no prompt ever
 * reaches Anthropic. Never fails: every unhappy path resolves to a probe whose
 * `absence` says why there is no number.
 */
export const probeClaudeSubscriptionUsage = (
  // Narrowed to the two fields the probe reads, so the caller can hand over a
  // sign-in it rebuilt from a cache key rather than a whole settings envelope.
  claudeSettings: Pick<ClaudeSettings, "binaryPath" | "homePath">,
  environment?: NodeJS.ProcessEnv,
  cwd?: string,
): Effect.Effect<ClaudeSubscriptionUsageProbe, never, Path.Path> => {
  const abort = new AbortController();
  const failed: ClaudeSubscriptionUsageProbe = {
    email: null,
    subscriptionType: null,
    fiveHour: null,
    sevenDay: null,
    absence: "failed",
  };

  return Effect.gen(function* () {
    const claudeEnvironment = yield* makeClaudeEnvironment(claudeSettings, environment);
    const executablePath = yield* resolveClaudeSdkExecutablePath(
      claudeSettings.binaryPath,
      claudeEnvironment,
    );

    return yield* Effect.tryPromise(async () => {
      const q = claudeQuery({
        // Never yield, so the subprocess starts up and answers control
        // requests without ever sending a turn to Anthropic.
        // oxlint-disable-next-line require-yield
        prompt: (async function* (): AsyncGenerator<SDKUserMessage> {
          await waitForAbortSignal(abort.signal);
        })(),
        options: buildClaudeCapabilitiesProbeQueryOptions({
          executablePath,
          abortController: abort,
          environment: claudeEnvironment,
          cwd,
        }),
      });

      const init = await q.initializationResult();
      const account = init.account as
        | { readonly email?: string; readonly subscriptionType?: string }
        | undefined;

      // A tool that started but names no account is signed out. Saying so
      // beats "usage not reported", which sounds like a limit nobody read.
      if (account === undefined) {
        return {
          email: null,
          subscriptionType: null,
          fiveHour: null,
          sevenDay: null,
          absence: "signedOut",
        } satisfies ClaudeSubscriptionUsageProbe;
      }

      const readUsage = (q as unknown as Record<string, undefined | (() => Promise<unknown>)>)[
        EXPERIMENTAL_USAGE_METHOD
      ];
      if (typeof readUsage !== "function") {
        return {
          email: account.email ?? null,
          subscriptionType: account.subscriptionType ?? null,
          fiveHour: null,
          sevenDay: null,
          absence: "unavailable",
        } satisfies ClaudeSubscriptionUsageProbe;
      }

      return readSubscriptionUsageResponse(await readUsage.call(q), account);
    });
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        if (!abort.signal.aborted) abort.abort();
      }),
    ),
    Effect.timeoutOption(USAGE_PROBE_TIMEOUT_MS),
    Effect.map((answer) => Option.getOrElse(answer, () => failed)),
    // `catchCause` and not `catchTag`: a binary that is missing, or an SDK
    // that throws where it used to return, arrives as a defect rather than as
    // a typed failure. One instance that cannot start must not stop the rest
    // of the list from being read.
    Effect.catchCause(() => Effect.succeed(failed)),
  );
};

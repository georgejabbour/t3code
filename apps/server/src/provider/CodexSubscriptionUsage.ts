/**
 * CodexSubscriptionUsage - read how much of a ChatGPT plan is left.
 *
 * Each Codex provider instance points at its own `CODEX_HOME`, so a machine
 * can hold several ChatGPT sign-ins at once. This module asks one instance how
 * much of its rate-limit window it has spent, so the subscription selector can
 * show what is left beside the Claude plans it already shows.
 *
 * ## How the number is read
 *
 * The Codex command-line tool has a long-running mode, `codex app-server`,
 * that speaks JSON-RPC over its standard input and output. T3 Code already
 * starts it for the provider health check. Two of its methods matter here:
 *
 * - `account/read` names the signed-in account and its plan.
 * - `account/rateLimits/read` returns the rate-limit windows.
 *
 * Both are declared in the generated protocol under
 * `packages/effect-codex-app-server`, so this file needs no string lookup of
 * the kind {@link ./ClaudeSubscriptionUsage.ts} needs for the Claude SDK.
 *
 * ## The two windows
 *
 * Codex does not name its windows. It states a duration in minutes, and the
 * durations differ between plans: one account reports a single seven-day
 * window, another reports a five-hour window and a seven-day window together.
 * {@link codexWindowLabel} turns a duration into the short name a person
 * reads, and {@link readCodexRateLimits} sorts each window into the short or
 * the long slot the selector draws.
 *
 * This fork keeps its additions in new files, so an upstream change rarely
 * conflicts with them.
 *
 * @module CodexSubscriptionUsage
 */
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as CodexClient from "effect-codex-app-server/client";
import type * as CodexSchema from "effect-codex-app-server/schema";
import * as CodexErrors from "effect-codex-app-server/errors";

import type { CodexSettings, SubscriptionUsageWindow } from "@t3tools/contracts";
import { resolveSpawnCommand } from "@t3tools/shared/shell";

import { expandHomePath } from "../pathExpansion.ts";
import { codexAppServerArgs } from "./Layers/codexLaunchArgs.ts";
import { buildCodexInitializeParams } from "./Layers/CodexProvider.ts";
import type { SubscriptionUsageProbe } from "./subscriptionUsageProbe.ts";
import { codexPlanLabel } from "./subscriptionUsageProbe.ts";

/**
 * Trace name for one read, and the marker that proves this patch is in a
 * build. See Patch 15 in PATCHES.md.
 */
const CODEX_USAGE_SPAN = "t3/provider/CodexSubscriptionUsage.probe";

/** How long the whole read may take before it is abandoned. */
const USAGE_PROBE_TIMEOUT_MS = 25_000;

/** How long the subprocess gets to exit before it is stopped outright. */
const FORCE_KILL_AFTER = "2 seconds" as const;

/** Longest window that still counts as the short one, in minutes. */
const SHORT_WINDOW_MAX_MINUTES = 24 * 60;

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

/**
 * The short name a person reads beside a window's percentage.
 *
 * Exported for its own test, because the durations Codex reports vary by plan
 * and every one of them has to come out readable.
 */
export function codexWindowLabel(
  windowDurationMins: number | null | undefined,
  fallback: string,
): string {
  if (
    typeof windowDurationMins !== "number" ||
    !Number.isFinite(windowDurationMins) ||
    windowDurationMins <= 0
  ) {
    return fallback;
  }
  if (windowDurationMins === MINUTES_PER_WEEK) {
    return "Week";
  }
  if (windowDurationMins < MINUTES_PER_HOUR) {
    return `${Math.round(windowDurationMins)}m`;
  }
  if (windowDurationMins < MINUTES_PER_DAY) {
    return `${Math.round(windowDurationMins / MINUTES_PER_HOUR)}h`;
  }
  return `${Math.round(windowDurationMins / MINUTES_PER_DAY)}d`;
}

/** Codex states a reset as seconds since 1970. The rest of T3 Code uses text. */
function resetsAtIso(resetsAt: number | null | undefined): string | null {
  if (typeof resetsAt !== "number" || !Number.isFinite(resetsAt) || resetsAt <= 0) {
    return null;
  }
  return DateTime.make(resetsAt * 1000).pipe(Option.map(DateTime.formatIso), Option.getOrNull);
}

function windowFrom(
  window: CodexSchema.V2GetAccountRateLimitsResponse["rateLimits"]["primary"],
  fallbackLabel: string,
): SubscriptionUsageWindow | null {
  if (window === null || window === undefined) {
    return null;
  }
  const utilization = window.usedPercent;
  if (!Number.isFinite(utilization)) {
    return null;
  }
  return {
    label: codexWindowLabel(window.windowDurationMins, fallbackLabel),
    // A plan over its allowance can report more than 100. Nothing beyond the
    // whole window is meaningful, and the contract refuses it.
    utilization: Math.max(0, Math.min(100, utilization)),
    resetsAt: resetsAtIso(window.resetsAt),
  };
}

/**
 * Sort Codex's two windows into the short slot and the long slot.
 *
 * Codex calls them "primary" and "secondary", and which one is longer depends
 * on the plan: a ChatGPT Pro 5x account reports a single seven-day window as
 * its primary, while other plans report five hours as primary and a week as
 * secondary. Sorting by the stated duration puts each one where the selector
 * expects it, whichever way round the account reports them.
 *
 * Exported so every shape a plan can report has a test that spawns nothing.
 */
export function readCodexRateLimits(
  rateLimits: CodexSchema.V2GetAccountRateLimitsResponse["rateLimits"] | undefined,
): {
  readonly fiveHour: SubscriptionUsageWindow | null;
  readonly sevenDay: SubscriptionUsageWindow | null;
} {
  const primary = windowFrom(rateLimits?.primary, "5h");
  const secondary = windowFrom(rateLimits?.secondary, "Week");
  const windows = [primary, secondary].filter(
    (window): window is SubscriptionUsageWindow => window !== null,
  );

  let fiveHour: SubscriptionUsageWindow | null = null;
  let sevenDay: SubscriptionUsageWindow | null = null;
  for (const window of windows) {
    const isLong = isLongWindowLabel(window.label);
    if (isLong) {
      // Two long windows would otherwise overwrite each other. Keep the first.
      sevenDay = sevenDay ?? window;
    } else {
      fiveHour = fiveHour ?? window;
    }
  }
  return { fiveHour, sevenDay };
}

/**
 * Whether a label names a window longer than a day.
 *
 * Reads the label rather than the raw minutes because the label is the only
 * thing that survives onto the wire, and the two must never disagree about
 * which slot a window belongs in.
 */
function isLongWindowLabel(label: string): boolean {
  if (label === "Week") {
    return true;
  }
  const days = /^(\d+)d$/u.exec(label);
  return days !== null && Number(days[1]) * MINUTES_PER_DAY > SHORT_WINDOW_MAX_MINUTES;
}

/**
 * Turn one account reply and one rate-limit reply into this fork's shape.
 *
 * Exported so every account state Codex can report has a test that spawns no
 * subprocess.
 */
export function readCodexSubscriptionUsage(
  account: CodexSchema.V2GetAccountResponse["account"] | undefined,
  rateLimits: CodexSchema.V2GetAccountRateLimitsResponse["rateLimits"] | undefined,
): SubscriptionUsageProbe {
  if (!account) {
    return {
      email: null,
      subscriptionType: null,
      fiveHour: null,
      sevenDay: null,
      absence: "signedOut",
    };
  }

  // An API key or a Bedrock sign-in bills per token. There is no plan window.
  if (account.type !== "chatgpt") {
    return {
      email: null,
      subscriptionType: account.type === "apiKey" ? "OpenAI API key" : "Amazon Bedrock",
      fiveHour: null,
      sevenDay: null,
      absence: "unsupported",
    };
  }

  const email = account.email ?? null;
  const subscriptionType = codexPlanLabel(rateLimits?.planType ?? account.planType);
  const { fiveHour, sevenDay } = readCodexRateLimits(rateLimits);

  return {
    email,
    subscriptionType,
    fiveHour,
    sevenDay,
    absence: fiveHour === null && sevenDay === null ? "unavailable" : null,
  };
}

/**
 * Ask one Codex instance how much of its plan is left.
 *
 * Starts `codex app-server`, asks it two questions and stops it again. Never
 * fails: every unhappy path resolves to a probe whose `absence` says why there
 * is no number.
 */
export const probeCodexSubscriptionUsage = (
  // Narrowed to the three fields the probe reads, so the caller can hand over
  // a sign-in it rebuilt from a cache key rather than a whole envelope.
  codexSettings: Pick<CodexSettings, "binaryPath" | "homePath" | "launchArgs">,
  environment: NodeJS.ProcessEnv,
  cwd: string,
): Effect.Effect<SubscriptionUsageProbe, never, ChildProcessSpawner.ChildProcessSpawner> => {
  const failed: SubscriptionUsageProbe = {
    email: null,
    subscriptionType: null,
    fiveHour: null,
    sevenDay: null,
    absence: "failed",
  };

  return Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    // `~` is not expanded for a variable handed to `spawn`, so `CODEX_HOME`
    // would reach codex verbatim and the tool would refuse to start.
    const resolvedHomePath = codexSettings.homePath ? expandHomePath(codexSettings.homePath) : "";
    const childEnvironment = {
      ...environment,
      ...(resolvedHomePath ? { CODEX_HOME: resolvedHomePath } : {}),
    };
    const spawnCommand = yield* resolveSpawnCommand(
      codexSettings.binaryPath,
      codexAppServerArgs(codexSettings.launchArgs),
      { env: childEnvironment, extendEnv: true },
    );
    const child = yield* spawner
      .spawn(
        ChildProcess.make(spawnCommand.command, spawnCommand.args, {
          cwd,
          env: childEnvironment,
          extendEnv: true,
          forceKillAfter: FORCE_KILL_AFTER,
          shell: spawnCommand.shell,
        }),
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new CodexErrors.CodexAppServerSpawnError({
              command: `${codexSettings.binaryPath} app-server`,
              cause,
            }),
        ),
      );

    const clientContext = yield* Layer.build(CodexClient.layerChildProcess(child));
    const client = yield* Effect.service(CodexClient.CodexAppServerClient).pipe(
      Effect.provide(clientContext),
    );

    yield* client.request("initialize", buildCodexInitializeParams());
    yield* client.notify("initialized", undefined);

    const accountResponse = yield* client.request("account/read", {});
    if (!accountResponse.account) {
      return readCodexSubscriptionUsage(undefined, undefined);
    }

    // A plan that reports no limits is a real answer, not a failure, so the
    // account above still names the row when this request comes back empty.
    const rateLimits = yield* client.request("account/rateLimits/read", undefined).pipe(
      Effect.map((response) => response.rateLimits),
      Effect.orElseSucceed(() => undefined),
    );

    return readCodexSubscriptionUsage(accountResponse.account, rateLimits);
  }).pipe(
    // The client layer and the subprocess are both scoped, so closing the
    // scope stops the tool however this ended.
    Effect.scoped,
    Effect.timeoutOption(USAGE_PROBE_TIMEOUT_MS),
    Effect.map((answer) => Option.getOrElse(answer, () => failed)),
    // `catchCause` and not `catchTag`: a binary that is missing, a path that
    // is not a string, or a protocol change that throws all arrive as defects
    // rather than as typed failures. One instance that cannot start must not
    // stop the rest of the list from being read.
    Effect.catchCause(() => Effect.succeed(failed)),
    Effect.withSpan(CODEX_USAGE_SPAN),
  );
};

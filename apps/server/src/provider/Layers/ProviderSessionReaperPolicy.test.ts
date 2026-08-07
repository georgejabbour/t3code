/**
 * Covers the two rules that decide whether the reaper may stop an agent at
 * all: the configured idle timeout, and live background work.
 *
 * Kept apart from ProviderSessionReaper.test.ts, which drives the reaper
 * through a ManagedRuntime harness. These use mocked layers instead, so they
 * add nothing to that file's manual-runner baseline.
 */
import { ProjectId, ProviderDriverKind, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ServerSettings from "../../serverSettings.ts";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
import { ProviderSessionReaper } from "../Services/ProviderSessionReaper.ts";
import { ProviderService } from "../Services/ProviderService.ts";
import { makeProviderSessionReaperLive } from "./ProviderSessionReaper.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const THREAD_ID = ThreadId.make("thread-reaper-policy");
const CLAUDE_AGENT_DRIVER = ProviderDriverKind.make("claudeAgent");

const threadShell = (backgroundLiveness: "working" | "monitoring" | null) => ({
  id: THREAD_ID,
  projectId: ProjectId.make("project-reaper-policy"),
  title: "Reaper policy thread",
  modelSelection: {
    instanceId: ProviderInstanceId.make("claudeAgent"),
    model: "claude-opus-5",
  },
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: NOW,
  updatedAt: NOW,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  backgroundLiveness,
  session: {
    threadId: THREAD_ID,
    status: "ready" as const,
    providerName: CLAUDE_AGENT_DRIVER,
    providerInstanceId: ProviderInstanceId.make("claudeAgent"),
    runtimeMode: "full-access" as const,
    // The turn is over. Only `backgroundLiveness` can still say work is alive.
    activeTurnId: null,
    lastError: null,
    updatedAt: NOW,
  },
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
});

const sweepOnce = (input: {
  readonly idleTimeout: Duration.Duration;
  readonly backgroundLiveness: "working" | "monitoring" | null;
}) => {
  const stoppedThreadIds: ThreadId[] = [];

  const layer = makeProviderSessionReaperLive({ sweepIntervalMs: 600_000 }).pipe(
    Layer.provideMerge(
      Layer.mock(ProviderSessionDirectory)({
        listBindings: () =>
          Effect.succeed([
            {
              threadId: THREAD_ID,
              provider: CLAUDE_AGENT_DRIVER,
              status: "running" as const,
              // `it.effect` runs on a test clock that starts at the epoch, so
              // "stale" has to mean older than 1970 — a 2020 timestamp would
              // read as an hour in the future and never look idle. A day
              // before the epoch clears every timeout these tests use.
              lastSeenAt: "1969-12-31T00:00:00.000Z",
            },
          ]) as never,
      }),
    ),
    Layer.provideMerge(
      Layer.mock(ProjectionSnapshotQuery)({
        getThreadShellById: () =>
          Effect.succeed(Option.some(threadShell(input.backgroundLiveness))) as never,
      }),
    ),
    Layer.provideMerge(
      Layer.mock(ProviderService)({
        stopSession: (request: { readonly threadId: ThreadId }) =>
          Effect.sync(() => {
            stoppedThreadIds.push(request.threadId);
          }) as never,
      }),
    ),
    Layer.provideMerge(ServerSettings.layerTest({ providerSessionIdleTimeout: input.idleTimeout })),
  );

  return Effect.gen(function* () {
    const reaper = yield* ProviderSessionReaper;
    yield* reaper.start();
    // `Effect.repeat` runs the first sweep before its first wait, so the work
    // is queued as soon as `start` returns; yield until it drains. A real
    // sleep would hang here, because the test clock never advances on its own.
    yield* Effect.forEach(Array.from({ length: 40 }), () => Effect.yieldNow, { discard: true });
    return stoppedThreadIds;
  }).pipe(Effect.provide(layer), Effect.scoped);
};

describe("ProviderSessionReaper policy", () => {
  it.effect("stops a stale session that has no background work", () =>
    Effect.gen(function* () {
      const stopped = yield* sweepOnce({
        idleTimeout: Duration.millis(1_000),
        backgroundLiveness: null,
      });

      assert.deepEqual(stopped, [THREAD_ID]);
    }),
  );

  it.effect("spares a stale session whose subagents are still working", () =>
    Effect.gen(function* () {
      const stopped = yield* sweepOnce({
        idleTimeout: Duration.millis(1_000),
        backgroundLiveness: "working",
      });

      assert.deepEqual(stopped, []);
    }),
  );

  it.effect("spares a stale session whose watch loops are still monitoring", () =>
    Effect.gen(function* () {
      const stopped = yield* sweepOnce({
        idleTimeout: Duration.millis(1_000),
        backgroundLiveness: "monitoring",
      });

      assert.deepEqual(stopped, []);
    }),
  );

  it.effect("stops nothing at all when the idle timeout is zero", () =>
    Effect.gen(function* () {
      const stopped = yield* sweepOnce({
        idleTimeout: Duration.zero,
        backgroundLiveness: null,
      });

      assert.deepEqual(stopped, []);
    }),
  );
});

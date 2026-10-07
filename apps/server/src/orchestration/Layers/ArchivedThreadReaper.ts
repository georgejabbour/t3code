/**
 * Deletes idle archived conversations once a day when the setting is enabled.
 * Storage cleanup handles worktrees after deletion under its own rules.
 */
import { CommandId } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Crypto from "effect/Crypto";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";

import { forkParked } from "../../serverActivation.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import {
  ArchivedThreadReaper,
  type ArchivedThreadReaperShape,
} from "../Services/ArchivedThreadReaper.ts";

/** How long the sweep waits before it is willing to run again. */
const DEFAULT_SWEEP_PERIOD = Duration.hours(24);

/**
 * The tick only has to be fine enough to notice that the sweep period has
 * passed. Keeping it well under that period also makes turning the setting on
 * take effect within the hour instead of a day later.
 */
const DEFAULT_TICK_INTERVAL = Duration.hours(1);

export interface ArchivedThreadReaperLiveOptions {
  readonly tickInterval?: Duration.Duration;
  readonly sweepPeriod?: Duration.Duration;
}

const makeArchivedThreadReaper = (options?: ArchivedThreadReaperLiveOptions) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const serverSettings = yield* ServerSettingsService;
    const crypto = yield* Crypto.Crypto;

    const tickInterval = options?.tickInterval ?? DEFAULT_TICK_INTERVAL;
    const sweepPeriodMs = Duration.toMillis(options?.sweepPeriod ?? DEFAULT_SWEEP_PERIOD);
    const lastSweptAt = yield* Ref.make<number | null>(null);

    const commandId = crypto.randomUUIDv4.pipe(
      Effect.map((uuid) => CommandId.make(`server:archived-thread-reaper:${uuid}`)),
    );

    const sweep = Effect.gen(function* () {
      const settings = yield* serverSettings.getSettings;
      if (!settings.deleteArchivedThreadsNightly) {
        return;
      }

      const now = yield* Clock.currentTimeMillis;
      const previous = yield* Ref.get(lastSweptAt);
      // A null previous is a server that just started, which sweeps on its
      // first tick rather than waiting out a whole period.
      if (previous !== null && now - previous < sweepPeriodMs) {
        return;
      }

      const snapshot = yield* orchestrator.getShellSnapshot({ location: "archive" });
      let deletedCount = 0;
      let skippedCount = 0;

      for (const thread of snapshot.archivedThreads) {
        const archivedAt = thread.archivedAt;
        if (archivedAt === null) {
          continue;
        }

        if (
          thread.activeRunId !== null ||
          ["preparing", "queued", "starting", "running", "waiting"].includes(thread.status) ||
          thread.pendingRuntimeRequest !== null ||
          (thread.pendingBackgroundTasks?.length ?? 0) > 0
        ) {
          skippedCount += 1;
          continue;
        }

        const deleted = yield* commandId.pipe(
          Effect.flatMap((id) =>
            orchestrator.dispatch({
              type: "thread.delete",
              commandId: id,
              threadId: thread.id,
              expectedArchivedAt: archivedAt,
            }),
          ),
          Effect.as(true),
          Effect.catch((error) =>
            Effect.logWarning("orchestration.archived-thread.reaper.delete-failed", {
              threadId: thread.id,
              error,
            }).pipe(Effect.as(false)),
          ),
        );

        if (deleted) {
          deletedCount += 1;
        } else {
          skippedCount += 1;
        }
      }

      // Recorded even when nothing was deleted: a sweep that found no work and
      // a sweep that never ran look identical without it.
      yield* Ref.set(lastSweptAt, now);
      yield* Effect.logInfo("orchestration.archived-thread.reaper.sweep-complete", {
        archivedCount: snapshot.archivedThreads.length,
        deletedCount,
        skippedCount,
      });
    });

    const worker = yield* makeDrainableWorker(() =>
      sweep.pipe(
        Effect.catch((error: unknown) =>
          Effect.logWarning("orchestration.archived-thread.reaper.sweep-failed", { error }),
        ),
        Effect.catchDefect((defect: unknown) =>
          Effect.logWarning("orchestration.archived-thread.reaper.sweep-defect", { defect }),
        ),
      ),
    );

    const start: ArchivedThreadReaperShape["start"] = () =>
      Effect.gen(function* () {
        yield* forkParked(
          worker
            .enqueue(undefined)
            .pipe(Effect.andThen(worker.drain), Effect.repeat(Schedule.spaced(tickInterval))),
        );

        yield* Effect.logInfo("orchestration.archived-thread.reaper.started", {
          tickIntervalMs: Duration.toMillis(tickInterval),
        });
      });

    return { start, drain: worker.drain } satisfies ArchivedThreadReaperShape;
  });

export const makeArchivedThreadReaperLive = (options?: ArchivedThreadReaperLiveOptions) =>
  Layer.effect(ArchivedThreadReaper, makeArchivedThreadReaper(options));

export const ArchivedThreadReaperLive = makeArchivedThreadReaperLive();

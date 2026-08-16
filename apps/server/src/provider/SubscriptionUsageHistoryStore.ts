/**
 * SubscriptionUsageHistoryStore - keep the peak of each plan window on disk.
 *
 * One row per rate-limit window, held in a JSON file beside the rest of the
 * server's state.
 *
 * ## Why a file and not a table
 *
 * A migration numbered by this fork collides with the first migration upstream
 * adds at the same number, and this fork rebases onto a nightly build most
 * days. The record is also small by construction: one row per window, so two
 * subscriptions over ninety days come to roughly a thousand rows. A file
 * conflicts with nothing and costs nothing to read whole.
 *
 * @module SubscriptionUsageHistoryStore
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  SubscriptionUsageHistory,
  type SubscriptionUsage,
  type SubscriptionWindowPeak,
} from "@t3tools/contracts";
import {
  pruneSubscriptionHistory,
  recordSubscriptionSample,
} from "@t3tools/shared/subscriptionUsageHistory";

import * as ServerConfig from "../config.ts";

/** How long a window is kept after it closed. */
export const SUBSCRIPTION_HISTORY_RETENTION_DAYS = 90;

const HISTORY_FILE_NAME = "subscription-usage-history.json";

const HistoryFromJson = Schema.fromJsonString(SubscriptionUsageHistory);
const decodeHistoryJson = Schema.decodeUnknownExit(HistoryFromJson);
const encodeHistoryJson = Schema.encodeUnknownSync(HistoryFromJson);

const RETENTION_MS = SUBSCRIPTION_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export class SubscriptionUsageHistoryStore extends Context.Service<
  SubscriptionUsageHistoryStore,
  {
    /** Every window kept, oldest reset first. Never fails. */
    readonly read: Effect.Effect<SubscriptionUsageHistory>;
    /**
     * Fold one reading of each subscription into the record and save it.
     *
     * Reads, merges and writes in one call rather than holding the record in
     * memory, because the sampler runs rarely and a file that is only ever
     * rewritten whole cannot drift from what a reader sees.
     */
    readonly record: (input: {
      readonly subscriptions: ReadonlyArray<SubscriptionUsage>;
      readonly sampledAt: string;
    }) => Effect.Effect<void>;
  }
>()("t3/provider/SubscriptionUsageHistoryStore") {}

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const filePath = path.join(config.stateDir, HISTORY_FILE_NAME);

  /** A record that cannot be read is an empty one, never an error. */
  const read: SubscriptionUsageHistoryStore["Service"]["read"] = fileSystem
    .readFileString(filePath)
    .pipe(
      Effect.map((contents) => {
        const decoded = decodeHistoryJson(contents);
        return decoded._tag === "Success"
          ? decoded.value
          : { peaks: [] as ReadonlyArray<SubscriptionWindowPeak> };
      }),
      Effect.orElseSucceed(() => ({ peaks: [] as ReadonlyArray<SubscriptionWindowPeak> })),
    );

  const record: SubscriptionUsageHistoryStore["Service"]["record"] = Effect.fn(
    "SubscriptionUsageHistoryStore.record",
  )(function* (input) {
    const current = yield* read;

    let peaks = current.peaks;
    for (const subscription of input.subscriptions) {
      peaks = recordSubscriptionSample(peaks, subscription, input.sampledAt);
    }

    const cutoff = DateTime.make(Date.parse(input.sampledAt) - RETENTION_MS).pipe(
      Option.map(DateTime.formatIso),
    );
    if (Option.isSome(cutoff)) {
      peaks = pruneSubscriptionHistory(peaks, cutoff.value);
    }

    // Write beside the target and move it into place, so a reader never sees a
    // half-written file and a crash mid-write cannot destroy the record.
    const temporaryPath = `${filePath}.tmp`;
    yield* fileSystem.writeFileString(temporaryPath, `${encodeHistoryJson({ peaks })}\n`).pipe(
      Effect.andThen(fileSystem.rename(temporaryPath, filePath)),
      Effect.catchCause((cause) =>
        Effect.logWarning("could not save the subscription usage history", {
          filePath,
          cause: String(cause),
        }),
      ),
    );
  });

  return SubscriptionUsageHistoryStore.of({ read, record });
});

export const layer = Layer.effect(SubscriptionUsageHistoryStore, make);

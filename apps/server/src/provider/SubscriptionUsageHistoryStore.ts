/** Quota peaks from native provider snapshots, stored with an atomic file replacement. */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { SubscriptionUsageHistory, type ServerProvider } from "@t3tools/contracts";
import {
  pruneSubscriptionHistory,
  recordSubscriptionSample,
} from "@t3tools/shared/subscriptionUsageHistory";
import * as ServerConfig from "../config.ts";
import { ProviderRegistry } from "./Services/ProviderRegistry.ts";

export const SUBSCRIPTION_HISTORY_RETENTION_DAYS = 90;
const HISTORY_FILE_NAME = "subscription-usage-history.json";
const HistoryFromJson = Schema.fromJsonString(SubscriptionUsageHistory);
const decodeHistoryJson = Schema.decodeUnknownEffect(HistoryFromJson);
const encodeHistoryJson = Schema.encodeUnknownSync(HistoryFromJson);
const RETENTION_MS = SUBSCRIPTION_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export class SubscriptionUsageHistoryStore extends Context.Service<
  SubscriptionUsageHistoryStore,
  {
    readonly read: Effect.Effect<SubscriptionUsageHistory>;
    readonly record: (input: {
      readonly providers: ReadonlyArray<ServerProvider>;
    }) => Effect.Effect<void>;
  }
>()("t3/provider/SubscriptionUsageHistoryStore") {}

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const registry = yield* ProviderRegistry;
  const lock = yield* Semaphore.make(1);
  const filePath = path.join(config.stateDir, HISTORY_FILE_NAME);
  const readCurrent = Effect.gen(function* () {
    if (!(yield* fileSystem.exists(filePath)))
      return { peaks: [] } satisfies SubscriptionUsageHistory;
    return yield* fileSystem.readFileString(filePath).pipe(Effect.flatMap(decodeHistoryJson));
  });
  const logFailure = (cause: unknown) =>
    Effect.logWarning("Could not save subscription usage history", {
      filePath,
      cause: String(cause),
    });
  const record: SubscriptionUsageHistoryStore["Service"]["record"] = Effect.fn(
    "SubscriptionUsageHistoryStore.record",
  )(
    function* (input) {
      const current = yield* readCurrent;
      let peaks = current.peaks;
      for (const provider of input.providers) peaks = recordSubscriptionSample(peaks, provider);
      const now = yield* DateTime.now;
      const cutoff = DateTime.formatIso(DateTime.subtractDuration(now, RETENTION_MS));
      const retained = pruneSubscriptionHistory(peaks, cutoff);
      if (peaks === current.peaks && retained.length === peaks.length) return;
      const temporaryPath = `${filePath}.tmp`;
      yield* fileSystem.makeDirectory(config.stateDir, { recursive: true });
      yield* fileSystem.writeFileString(
        temporaryPath,
        `${encodeHistoryJson({ peaks: retained })}\n`,
      );
      yield* fileSystem.rename(temporaryPath, filePath);
    },
    lock.withPermits(1),
    Effect.catchCause(logFailure),
  );
  // A history request includes the current native reading even if its change event is still queued.
  const read = Effect.gen(function* () {
    yield* record({ providers: yield* registry.getProviders });
    return yield* lock.withPermits(1)(readCurrent);
  }).pipe(Effect.catchCause((cause) => logFailure(cause).pipe(Effect.as({ peaks: [] }))));

  // Start the pull immediately so the native change subscription exists before the initial read.
  const pull = yield* Stream.toPull(registry.streamChanges);
  yield* Effect.gen(function* () {
    const updates = yield* pull;
    for (const providers of updates) yield* record({ providers });
  }).pipe(Effect.forever, Effect.forkScoped({ startImmediately: true }));
  yield* record({ providers: yield* registry.getProviders });
  return SubscriptionUsageHistoryStore.of({ read, record });
});
export const layer = Layer.effect(SubscriptionUsageHistoryStore, make);

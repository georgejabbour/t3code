import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  SubscriptionUsageHistory,
  type ServerProvider,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as ServerConfig from "../config.ts";
import { ProviderRegistry } from "./Services/ProviderRegistry.ts";
import { make } from "./SubscriptionUsageHistoryStore.ts";

const checkedAt = "2026-10-01T12:00:00.000Z";
const provider = (email = "me@example.com", usedPercent = 23): ServerProvider => ({
  instanceId: ProviderInstanceId.make("codex"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated", email },
  checkedAt,
  models: [],
  skills: [],
  slashCommands: [],
  usageLimits: {
    checkedAt,
    windows: [
      {
        id: "weekly",
        kind: "weekly",
        label: "Weekly",
        usedPercent,
        resetsAt: "2026-10-02T12:00:00.000Z",
      },
    ],
  },
});
const encode = Schema.encodeSync(Schema.fromJsonString(SubscriptionUsageHistory));
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(SubscriptionUsageHistory));
const harness = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const scratch = path.join(process.cwd(), ".scratch");
  yield* fs.makeDirectory(scratch, { recursive: true });
  const baseDir = yield* fs.makeTempDirectoryScoped({
    directory: scratch,
    prefix: "usage-history-",
  });
  const config = yield* ServerConfig.ServerConfig.pipe(
    Effect.provide(ServerConfig.layerTest(process.cwd(), baseDir)),
  );
  const filePath = path.join(config.stateDir, "subscription-usage-history.json");
  const changes = yield* PubSub.unbounded<ReadonlyArray<ServerProvider>>();
  const current = yield* Ref.make<ReadonlyArray<ServerProvider>>([]);
  const saved = yield* Queue.unbounded<void>();
  const failRename = yield* Ref.make(false);
  const instrumentedFs = {
    ...fs,
    rename: (from: string, to: string) =>
      Effect.gen(function* () {
        if (yield* Ref.get(failRename)) return yield* Effect.die("injected rename failure");
        yield* fs.rename(from, to);
        yield* Queue.offer(saved, undefined);
      }),
  };
  const dependencies = Layer.mergeAll(
    Layer.succeed(ServerConfig.ServerConfig, config),
    Layer.succeed(FileSystem.FileSystem, instrumentedFs),
    Layer.mock(ProviderRegistry)({
      getProviders: Ref.get(current),
      streamChanges: Stream.fromPubSub(changes),
    }),
  );
  const store = yield* make.pipe(Effect.provide(dependencies));
  return {
    fs,
    filePath,
    current,
    changes,
    saved,
    failRename,
    store,
    reopen: make.pipe(Effect.provide(dependencies)),
  };
});

it.effect("records streamed native readings and persists them across restart", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    const next = [provider()];
    yield* Ref.set(h.current, next);
    yield* PubSub.publish(h.changes, next);
    yield* Queue.take(h.saved);
    const disk = decode(yield* h.fs.readFileString(h.filePath));
    assert.strictEqual(disk.peaks[0]?.peakUtilization, 23);
    const reopened = yield* h.reopen;
    assert.deepStrictEqual(yield* reopened.read, disk);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("serializes concurrent recordings without losing either account", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* Effect.forEach(
      [provider(), provider("other@example.com", 98)],
      (p) => h.store.record({ providers: [p] }),
      { concurrency: "unbounded" },
    );
    const stored = decode(yield* h.fs.readFileString(h.filePath));
    assert.deepStrictEqual(stored.peaks.map((p) => p.accountKey).sort(), [
      "codex:me@example.com",
      "codex:other@example.com",
    ]);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("flushes the native cache before a history read without refreshing providers", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* Ref.set(h.current, [provider()]);
    const result = yield* h.store.read;
    assert.strictEqual(result.peaks[0]?.peakUtilization, 23);
    assert.strictEqual((yield* h.store.read).peaks[0]?.sampleCount, 1);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("preserves legacy records and a valid file after failed replacement", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    const legacy = {
      instanceId: ProviderInstanceId.make("codex"),
      window: "sevenDay",
      resetsAt: "2026-10-02T12:00:00.000Z",
      peakUtilization: 15,
      firstSampledAt: checkedAt,
      lastSampledAt: checkedAt,
      sampleCount: 47,
    };
    yield* h.fs.writeFileString(h.filePath, encode({ peaks: [legacy] }));
    yield* h.store.record({ providers: [provider()] });
    const original = yield* h.fs.readFileString(h.filePath);
    assert.deepStrictEqual(decode(original).peaks[0], legacy);
    yield* Ref.set(h.failRename, true);
    yield* h.store.record({ providers: [provider("other@example.com")] });
    assert.strictEqual(yield* h.fs.readFileString(h.filePath), original);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("does not overwrite malformed existing history", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* h.fs.writeFileString(h.filePath, "broken history");
    yield* h.store.record({ providers: [provider()] });
    assert.strictEqual(yield* h.fs.readFileString(h.filePath), "broken history");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("uses server time for retention even when the native reading is old", () =>
  Effect.gen(function* () {
    const h = yield* harness;
    yield* h.store.record({ providers: [provider()] });
    yield* TestClock.setTime(
      DateTime.toEpochMillis(DateTime.makeUnsafe("2026-10-03T00:00:00.000Z")),
    );
    yield* h.store.record({ providers: [] });
    assert.strictEqual(decode(yield* h.fs.readFileString(h.filePath)).peaks.length, 1);
    yield* TestClock.setTime(
      DateTime.toEpochMillis(DateTime.makeUnsafe("2026-12-31T12:00:00.000Z")),
    );
    yield* h.store.record({ providers: [] });
    assert.strictEqual(decode(yield* h.fs.readFileString(h.filePath)).peaks.length, 1);
    yield* TestClock.setTime(
      DateTime.toEpochMillis(DateTime.makeUnsafe("2026-12-31T12:00:00.001Z")),
    );
    yield* h.store.record({ providers: [] });
    assert.deepStrictEqual(decode(yield* h.fs.readFileString(h.filePath)).peaks, []);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

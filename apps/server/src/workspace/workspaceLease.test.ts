import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { withWorkspaceLease, withWorkspaceLeases, withWorkspaceUse } from "./workspaceLease.ts";

it.effect("reuses startup leases on the owning fiber while child fibers still wait", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    const child = yield* withWorkspaceLease(
      "/lease-fixture/reentrant",
      Effect.gen(function* () {
        const child = yield* withWorkspaceUse(
          "/lease-fixture/reentrant/subfolder",
          Deferred.succeed(entered, undefined),
        ).pipe(Effect.forkChild({ startImmediately: true }));
        yield* withWorkspaceUse("/lease-fixture/reentrant/subfolder", Effect.void);
        yield* withWorkspaceLease("/lease-fixture/reentrant", Effect.void);
        assert.isFalse(yield* Deferred.isDone(entered));
        return child;
      }),
    );
    yield* Fiber.join(child);
    assert.isTrue(yield* Deferred.isDone(entered));
  }),
);

it.effect("allows nested shared use to finish when cleanup is already waiting", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    const cleanup = yield* withWorkspaceUse(
      "/lease-fixture/shared-reentrant",
      Effect.gen(function* () {
        const cleanup = yield* withWorkspaceLease(
          "/lease-fixture/shared-reentrant",
          Deferred.succeed(entered, undefined),
        ).pipe(Effect.forkChild({ startImmediately: true }));
        yield* withWorkspaceUse("/lease-fixture/shared-reentrant", Effect.void);
        assert.isFalse(yield* Deferred.isDone(entered));
        return cleanup;
      }),
    );
    yield* Fiber.join(cleanup);
  }),
);

it.effect(
  "keeps workspace users concurrent, reserves cleanup capacity, and releases interrupted waiters",
  () =>
    Effect.gen(function* () {
      const active = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const first = yield* withWorkspaceUse(
        "/lease-fixture/a",
        Deferred.succeed(active, undefined).pipe(Effect.andThen(Deferred.await(release))),
      ).pipe(Effect.forkChild);
      yield* Deferred.await(active);
      // A second provider can start while the first provider uses the checkout.
      yield* withWorkspaceUse("/lease-fixture/a", Effect.void);
      const cleaning = yield* Deferred.make<void>();
      const cleanup = yield* withWorkspaceLease(
        "/lease-fixture/a",
        Deferred.succeed(cleaning, undefined),
      ).pipe(Effect.forkChild({ startImmediately: true }));
      const cancelled = yield* withWorkspaceUse("/lease-fixture/a/subfolder", Effect.void).pipe(
        Effect.forkChild({ startImmediately: true }),
      );
      yield* Fiber.interrupt(cancelled);
      assert.isFalse(yield* Deferred.isDone(cleaning));
      // Unrelated work does not wait on a blocked cleanup or its cancelled waiter.
      yield* withWorkspaceUse("/lease-fixture/b", Effect.void);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(cleanup);
      yield* withWorkspaceUse("/lease-fixture/a", Effect.void);
    }),
);

it.effect("holds root configuration steady while allowing other workspaces to start", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const cleanup = yield* withWorkspaceLeases(
      ["/lease-fixture/worktree"],
      Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))),
      "exclusive",
      ["/lease-fixture/root"],
    ).pipe(Effect.forkChild);
    yield* Deferred.await(entered);
    yield* withWorkspaceUse("/lease-fixture/root", Effect.void);
    const moved = yield* Deferred.make<void>();
    const move = yield* withWorkspaceLease(
      "/lease-fixture/root",
      Deferred.succeed(moved, undefined),
    ).pipe(Effect.forkChild({ startImmediately: true }));
    assert.isFalse(yield* Deferred.isDone(moved));
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(cleanup);
    yield* Fiber.join(move);
    assert.isTrue(yield* Deferred.isDone(moved));
  }),
);

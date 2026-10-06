import {
  EnvironmentId,
  GitStackCommandError,
  WS_METHODS,
  WsRpcGroup,
  type GitStackView,
} from "@t3tools/contracts";
import { it as effectIt } from "@effect/vitest";
import { describe, expect, it } from "vite-plus/test";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { RpcClient, type RpcMessage } from "effect/rpc";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type NetworkStatus,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "../connection/model.ts";
import type { ConnectionCatalogEntry } from "../connection/catalog.ts";
import { EnvironmentNotRegisteredError, EnvironmentRegistry } from "../connection/registry.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import type { RpcSession } from "../rpc/session.ts";
import {
  createGitStackEnvironmentAtoms,
  createGitStackPositionLabelsAtomFamily,
  gitStackPositionLabelKey,
  makeGitStackPositionLabelsKey,
  type GitStackPositionLabelTarget,
} from "./gitStacks.ts";

const target: GitStackPositionLabelTarget = {
  environmentId: EnvironmentId.make("env-a"),
  cwd: "/repo",
  host: "github.com",
  repository: "owner/repo",
  headBranch: "feature/login",
  number: 7,
};

function stack(reference = target, position = 2): GitStackView {
  return {
    trunk: "main",
    currentBranch: "another-branch",
    branches: Array.from({ length: 3 }, (_, index) => ({
      name: index + 1 === position ? reference.headBranch : `other-${index}`,
      head: "",
      base: "",
      isCurrent: false,
      isMerged: false,
      isQueued: false,
      needsRebase: false,
      pr: {
        number: reference.number,
        url: `https://${reference.host}/${reference.repository}/pull/${reference.number}`,
        state: "open",
      },
    })),
  };
}

describe("scoped extension stack labels", () => {
  it("keeps identical branch names separate across environments, checkouts, repositories, and hosts", () => {
    const targets = [
      target,
      { ...target, environmentId: EnvironmentId.make("env-b") },
      { ...target, cwd: "/other-checkout" },
      { ...target, repository: "owner/other" },
      { ...target, host: "github.enterprise.test" },
    ];
    const labels = createGitStackPositionLabelsAtomFamily<Error>(({ environmentId, input }) => {
      const reference = targets.find(
        (item) => item.environmentId === environmentId && item.cwd === input.cwd,
      );
      // Repository and host cases share a checkout, so this checkout cannot answer those rows.
      return Atom.make(AsyncResult.success(reference ? stack(reference) : null));
    });
    const registry = AtomRegistry.make();
    try {
      const result = registry.get(labels(makeGitStackPositionLabelsKey(targets)));
      expect(result.size).toBe(3);
      for (const reference of targets.slice(0, 3))
        expect(result.get(gitStackPositionLabelKey(reference))).toBe("2/3");
      for (const reference of targets.slice(3))
        expect(result.has(gitStackPositionLabelKey(reference))).toBe(false);
      expect(new Set(targets.map(gitStackPositionLabelKey)).size).toBe(5);
    } finally {
      registry.dispose();
    }
  });

  it.each([
    ["another repository", { repository: "owner/other" }],
    ["another host", { host: "github.enterprise.test" }],
    ["another pull request", { number: 8 }],
    ["another branch", { headBranch: "feature/other" }],
  ])("rejects stack data for %s", (_, override) => {
    const labels = createGitStackPositionLabelsAtomFamily<Error>(() =>
      Atom.make(AsyncResult.success(stack({ ...target, ...override }))),
    );
    const registry = AtomRegistry.make();
    try {
      expect(registry.get(labels(makeGitStackPositionLabelsKey([target]))).size).toBe(0);
    } finally {
      registry.dispose();
    }
  });

  it("accepts GitHub host and repository case differences", () => {
    const labels = createGitStackPositionLabelsAtomFamily<Error>(() =>
      Atom.make(
        AsyncResult.success(stack({ ...target, host: "GitHub.COM", repository: "Owner/Repo" })),
      ),
    );
    const registry = AtomRegistry.make();
    try {
      expect(
        registry
          .get(labels(makeGitStackPositionLabelsKey([target])))
          .get(gitStackPositionLabelKey(target)),
      ).toBe("2/3");
    } finally {
      registry.dispose();
    }
  });

  it("removes a failed read's previous label and tolerates initial or missing stack data", () => {
    const success = AsyncResult.success<GitStackView | null, Error>(stack());
    const view = Atom.make<AsyncResult.AsyncResult<GitStackView | null, Error>>(success);
    const labels = createGitStackPositionLabelsAtomFamily(() => view);
    const registry = AtomRegistry.make();
    const atom = labels(makeGitStackPositionLabelsKey([target]));
    const unmount = registry.mount(atom);
    try {
      expect(registry.get(atom).get(gitStackPositionLabelKey(target))).toBe("2/3");
      registry.set(
        view,
        AsyncResult.failure(Cause.fail(new Error("unreachable")), {
          previousSuccess: Option.some(success),
        }),
      );
      expect(registry.get(atom).size).toBe(0);
      registry.set(view, AsyncResult.initial());
      expect(registry.get(atom).size).toBe(0);
      registry.set(view, AsyncResult.success(null));
      expect(registry.get(atom).size).toBe(0);
    } finally {
      unmount();
      registry.dispose();
    }
  });

  it("keeps target keys stable and deduplicates repeated rows", () => {
    const other = { ...target, cwd: "/other" };
    expect(makeGitStackPositionLabelsKey([target, other, target])).toBe(
      makeGitStackPositionLabelsKey([other, target]),
    );
  });
});

const decodeViewInput = Schema.decodeUnknownSync(
  Schema.Struct({ cwd: Schema.String, branch: Schema.String }),
);

effectIt.effect(
  "routes branch-specific label reads through the real query cache and RPC client",
  () =>
    Effect.gen(function* () {
      const requests: Array<{ environmentId: EnvironmentId; cwd: string; branch: string }> = [];
      const targets = [target, { ...target, environmentId: EnvironmentId.make("env-b") }];
      const failedEnvironments = new Set<EnvironmentId>();
      const supervisors = new Map<EnvironmentId, EnvironmentSupervisor["Service"]>();
      for (const [index, reference] of targets.entries()) {
        const responses = yield* Queue.unbounded<{
          _tag: "Exit";
          clientId: number;
          requestId: RpcMessage.RequestId;
          exit: Exit.Exit<GitStackView | null, GitStackCommandError>;
        }>();
        const protocol = yield* RpcClient.makeNoSerialization(WsRpcGroup, {
          onFromClient: ({ message }) =>
            Effect.gen(function* () {
              if (message._tag !== "Request" || message.tag !== WS_METHODS.gitStackView) return;
              const input = decodeViewInput(message.payload);
              requests.push({ environmentId: reference.environmentId, ...input });
              yield* Queue.offer(responses, {
                _tag: "Exit",
                clientId: 0,
                requestId: message.id,
                exit: failedEnvironments.has(reference.environmentId)
                  ? Exit.fail(new GitStackCommandError({ cwd: input.cwd, operation: "view" }))
                  : Exit.succeed(stack(reference, index + 1)),
              });
            }),
        });
        yield* Stream.fromQueue(responses).pipe(
          Stream.runForEach(protocol.write),
          Effect.forkScoped,
        );
        const session: RpcSession = {
          client: protocol.client,
          initialConfig: Effect.never,
          subscribeServerConfig: (input) =>
            protocol.client[WS_METHODS.subscribeServerConfig](input),
          ready: Effect.void,
          probe: Effect.void,
          closed: Effect.never,
        };
        supervisors.set(
          reference.environmentId,
          EnvironmentSupervisor.of({
            target: new PrimaryConnectionTarget({
              environmentId: reference.environmentId,
              label: "Test",
              httpBaseUrl: "http://localhost",
              wsBaseUrl: "ws://localhost",
            }),
            state: yield* SubscriptionRef.make<SupervisorConnectionState>({
              ...AVAILABLE_CONNECTION_STATE,
              desired: true,
              phase: "connected",
              attempt: 1,
              generation: 1,
            }),
            session: yield* SubscriptionRef.make(Option.some(session)),
            prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
            connect: Effect.void,
            disconnect: Effect.void,
            retryNow: Effect.void,
          }),
        );
      }
      const supervisorFor = (id: EnvironmentId) => {
        const supervisor = supervisors.get(id);
        if (!supervisor) throw new EnvironmentNotRegisteredError({ environmentId: id });
        return supervisor;
      };
      const runtime = Atom.runtime(
        Layer.mock(EnvironmentRegistry)({
          entries: yield* SubscriptionRef.make<ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>>(
            new Map(),
          ),
          networkStatus: yield* SubscriptionRef.make<NetworkStatus>("online"),
          run: (id, effect) =>
            effect.pipe(Effect.provideService(EnvironmentSupervisor, supervisorFor(id))),
          followStream: (id, stream) =>
            stream.pipe(Stream.provideService(EnvironmentSupervisor, supervisorFor(id))),
        }),
      );
      const queries = createGitStackEnvironmentAtoms(runtime);
      const labels = createGitStackPositionLabelsAtomFamily(queries.view);
      const registry = AtomRegistry.make();
      const settled = yield* Deferred.make<void>();
      const unsubscribe = registry.subscribe(
        labels(makeGitStackPositionLabelsKey([...targets, target])),
        (value) => {
          if (value.size === 2) Deferred.doneUnsafe(settled, Effect.void);
        },
        { immediate: true },
      );
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          unsubscribe();
          registry.dispose();
        }),
      );
      yield* Deferred.await(settled);
      expect(requests).toHaveLength(2);
      expect(requests).toEqual(
        expect.arrayContaining(
          targets.map((reference) => ({
            environmentId: reference.environmentId,
            cwd: reference.cwd,
            branch: reference.headBranch,
          })),
        ),
      );
      const result = registry.get(labels(makeGitStackPositionLabelsKey(targets)));
      expect(result.get(gitStackPositionLabelKey(targets[0]!))).toBe("1/3");
      expect(result.get(gitStackPositionLabelKey(targets[1]!))).toBe("2/3");

      const view = queries.view({
        environmentId: target.environmentId,
        input: { cwd: target.cwd, branch: target.headBranch },
      });
      failedEnvironments.add(target.environmentId);
      registry.refresh(view);
      const failedRead = yield* Effect.exit(
        AtomRegistry.getResult(registry, view, { suspendOnWaiting: true }),
      );
      expect(Exit.isFailure(failedRead)).toBe(true);
      const afterFailure = registry.get(labels(makeGitStackPositionLabelsKey(targets)));
      expect(afterFailure.has(gitStackPositionLabelKey(target))).toBe(false);
      expect(afterFailure.get(gitStackPositionLabelKey(targets[1]!))).toBe("2/3");

      failedEnvironments.delete(target.environmentId);
      registry.refresh(view);
      yield* AtomRegistry.getResult(registry, view, { suspendOnWaiting: true });
      expect(
        registry
          .get(labels(makeGitStackPositionLabelsKey(targets)))
          .get(gitStackPositionLabelKey(target)),
      ).toBe("1/3");
    }).pipe(Effect.scoped),
);

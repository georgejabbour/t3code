// @effect-diagnostics nodeBuiltinImport:off -- Pure path comparison shares canonicalPath ownership rules.
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as NodePath from "node:path";

import { canonicalPath } from "../project/ManagedWorktree.ts";

const contains = (parent: string, child: string): boolean => {
  const relative = NodePath.relative(parent, child);
  return (
    relative === "" ||
    (!NodePath.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${NodePath.sep}`))
  );
};

/** Equal paths and parent/child workspaces share resources. */
export const workspacesOverlap = (left: string, right: string): boolean =>
  contains(left, right) || contains(right, left);

interface Lease {
  readonly owner: number;
  readonly paths: ReadonlyArray<{ readonly cwd: string; readonly mode: "shared" | "exclusive" }>;
  readonly ready: Deferred.Deferred<void>;
  granted: boolean;
}
const leases: Lease[] = [];
const grantWaiters = () => {
  for (const [index, lease] of leases.entries()) {
    if (lease.granted) continue;
    // Earlier waiters also reserve their path, so overlapping work cannot starve them.
    if (
      leases.some(
        (other, otherIndex) =>
          other !== lease &&
          (other.granted || otherIndex < index) &&
          lease.paths.some((resource) =>
            other.paths.some(
              (otherResource) =>
                (resource.mode === "exclusive" || otherResource.mode === "exclusive") &&
                workspacesOverlap(resource.cwd, otherResource.cwd),
            ),
          ),
      )
    )
      continue;
    lease.granted = true;
    Deferred.doneUnsafe(lease.ready, Effect.void);
  }
};

/** Coordinates cleanup and startup. Nested calls on the owning fiber reuse covered leases. */
export const withWorkspaceLeases = <A, E, R>(
  paths: ReadonlyArray<string>,
  effect: Effect.Effect<A, E, R>,
  mode: "shared" | "exclusive" = "exclusive",
  sharedPaths: ReadonlyArray<string> = [],
): Effect.Effect<A, E, R> =>
  Effect.withFiber((fiber) => {
    const requested = [
      ...paths.map((cwd) => ({ cwd: canonicalPath(cwd) ?? NodePath.resolve(cwd), mode })),
      ...sharedPaths.map((cwd) => ({
        cwd: canonicalPath(cwd) ?? NodePath.resolve(cwd),
        mode: "shared" as const,
      })),
    ].filter(
      (resource) =>
        !leases.some(
          (lease) =>
            lease.granted &&
            lease.owner === fiber.id &&
            lease.paths.some(
              (held) =>
                (held.mode === "exclusive" || resource.mode === "shared") &&
                contains(held.cwd, resource.cwd),
            ),
        ),
    );
    if (requested.length === 0) return effect;
    return Effect.acquireUseRelease(
      Effect.sync(() => {
        const lease: Lease = {
          owner: fiber.id,
          paths: requested,
          ready: Deferred.makeUnsafe<void>(),
          granted: false,
        };
        leases.push(lease);
        grantWaiters();
        return lease;
      }),
      (lease) => Deferred.await(lease.ready).pipe(Effect.andThen(effect)),
      (lease) =>
        Effect.sync(() => {
          leases.splice(leases.indexOf(lease), 1);
          grantWaiters();
        }),
    );
  });

export const withWorkspaceLease = <A, E, R>(cwd: string, effect: Effect.Effect<A, E, R>) =>
  withWorkspaceLeases([cwd], effect);

/** Concurrent workspace users wait for exclusive cleanup and removal. */
export const withWorkspaceUse = <A, E, R>(cwd: string, effect: Effect.Effect<A, E, R>) =>
  withWorkspaceLeases([cwd], effect, "shared");

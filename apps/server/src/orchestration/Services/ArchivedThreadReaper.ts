import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface ArchivedThreadReaperShape {
  /**
   * Start the once-a-day sweep that deletes archived threads within the
   * provided scope.
   */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
}

export class ArchivedThreadReaper extends Context.Service<
  ArchivedThreadReaper,
  ArchivedThreadReaperShape
>()("t3/orchestration/Services/ArchivedThreadReaper") {}

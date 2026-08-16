/**
 * SubscriptionSelectorPanel - the subscription selector, wired to a server.
 *
 * Keeps the reading and writing in one place so both the sidebar button and
 * the provider settings screen show the same panel and stay in step.
 *
 * This fork keeps its additions in new files, so an upstream change rarely
 * conflicts with them.
 */
import {
  EnvironmentId,
  type ProviderInstanceId,
  type SubscriptionUsageHistory,
  type SubscriptionUsageList,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import * as Option from "effect/Option";
import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";

import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";

import { SubscriptionHistory } from "./SubscriptionHistory";
import { SubscriptionSelector } from "./SubscriptionSelector";

// Stands in while no environment is chosen. The request is never sent, so the
// name only has to be one no real environment takes.
const NO_ENVIRONMENT_ID = EnvironmentId.make("t3code:no-environment");

export function SubscriptionSelectorPanel({
  environmentId,
  activeInstanceId,
  onSelect,
  onAfterAddSubscription,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly activeInstanceId: string | null;
  readonly onSelect: (instanceId: ProviderInstanceId) => void;
  readonly onAfterAddSubscription?: () => void;
}) {
  const navigate = useNavigate();
  // The query family is keyed by the whole request, and it needs an
  // environment. Without one there is nothing to ask, so the panel reads the
  // idle result the family returns for a request it never sends.
  const result = useAtomValue(
    serverEnvironment.subscriptionUsage(
      environmentId === null
        ? { environmentId: NO_ENVIRONMENT_ID, input: {} }
        : { environmentId, input: {} },
    ),
  );
  const refresh = useAtomCommand(serverEnvironment.refreshSubscriptionUsage, {
    reportFailure: false,
  });

  const historyResult = useAtomValue(
    serverEnvironment.subscriptionUsageHistory(
      environmentId === null
        ? { environmentId: NO_ENVIRONMENT_ID, input: {} }
        : { environmentId, input: {} },
    ),
  );

  const usage = Option.getOrNull(AsyncResult.value(result)) as SubscriptionUsageList | null;
  const history = Option.getOrNull(
    AsyncResult.value(historyResult),
  ) as SubscriptionUsageHistory | null;
  const isLoading = AsyncResult.isWaiting(result);

  const handleRefresh = useCallback(() => {
    if (environmentId === null) {
      return;
    }
    void refresh({ environmentId, input: {} });
  }, [environmentId, refresh]);

  const handleAddSubscription = useCallback(() => {
    onAfterAddSubscription?.();
    void navigate({ to: "/settings/providers" });
  }, [navigate, onAfterAddSubscription]);

  return (
    <SubscriptionSelector
      usage={usage}
      isLoading={isLoading}
      activeInstanceId={activeInstanceId}
      onSelect={onSelect}
      onRefresh={handleRefresh}
      onAddSubscription={handleAddSubscription}
      environmentId={environmentId}
    >
      {activeInstanceId === null ? null : (
        <SubscriptionHistory
          history={history}
          instanceId={activeInstanceId}
          nowIso={new Date().toISOString()}
        />
      )}
    </SubscriptionSelector>
  );
}

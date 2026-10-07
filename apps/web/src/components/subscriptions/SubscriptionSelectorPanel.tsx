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
} from "@t3tools/contracts";
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { refreshUsageLimits } from "@t3tools/client-runtime/state/usage";
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
  /** Closes the popover, so navigating away does not leave it open behind. */
  readonly onAfterAddSubscription?: () => void;
}) {
  const navigate = useNavigate();
  const [isRefreshingServer, setIsRefreshingServer] = useState(false);
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const refreshServer = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const historyAtom = serverEnvironment.subscriptionUsageHistory({
    environmentId: environmentId ?? NO_ENVIRONMENT_ID,
    input: {},
  });
  const refreshHistory = useAtomRefresh(historyAtom);

  const historyResult = useAtomValue(historyAtom);
  const usage = config?.providers ?? null;
  const history: SubscriptionUsageHistory | null = Option.getOrNull(
    AsyncResult.value(historyResult),
  );
  const historyReadingKey = JSON.stringify(
    usage?.map((provider) => [
      provider.instanceId,
      provider.auth.email,
      provider.usageLimits?.checkedAt,
    ]),
  );
  useEffect(() => {
    // A native reading can add a peak while this popover stays open.
    if (historyReadingKey !== undefined) refreshHistory();
  }, [historyReadingKey, refreshHistory]);

  const handleRefresh = async () => {
    if (environmentId === null) return;
    setIsRefreshingServer(true);
    try {
      await refreshUsageLimits(environmentId, () => refreshServer({ environmentId, input: {} }));
    } finally {
      refreshHistory();
      setIsRefreshingServer(false);
    }
  };

  // `add: true` opens the add-provider dialog on arrival, so a reader who
  // asked to add a subscription lands on the form instead of on a screen they
  // have to search.
  const handleAddSubscription = useCallback(() => {
    onAfterAddSubscription?.();
    void navigate({ to: "/settings/providers", search: { add: true } });
  }, [navigate, onAfterAddSubscription]);

  const handleManageSubscription = useCallback(() => {
    onAfterAddSubscription?.();
    void navigate({ to: "/settings/providers" });
  }, [navigate, onAfterAddSubscription]);

  return (
    <SubscriptionSelector
      usage={usage}
      isRevalidating={isRefreshingServer}
      activeInstanceId={activeInstanceId}
      onSelect={onSelect}
      onRefresh={handleRefresh}
      onAddSubscription={handleAddSubscription}
      onManageSubscription={handleManageSubscription}
      environmentId={environmentId}
    >
      {activeInstanceId === null ? null : (
        <SubscriptionHistory
          history={history}
          provider={usage?.find((provider) => provider.instanceId === activeInstanceId) ?? null}
          nowIso={new Date().toISOString()}
        />
      )}
    </SubscriptionSelector>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";

import { ProviderSettingsPanel } from "../components/settings/ProviderSettingsPanel";

function SettingsProvidersRoute() {
  const target = Route.useSearch();
  return <ProviderSettingsPanel {...target} />;
}

export const Route = createFileRoute("/settings/providers")({
  validateSearch: (raw: Record<string, unknown>) => ({
    ...(typeof raw.environmentId === "string" && raw.environmentId.trim()
      ? { environmentId: EnvironmentId.make(raw.environmentId) }
      : {}),
    ...(typeof raw.instanceId === "string" && raw.instanceId.trim()
      ? { instanceId: ProviderInstanceId.make(raw.instanceId) }
      : {}),
  }),
  component: SettingsProvidersRoute,
  // Added by this fork. `?add=1` opens the add-provider dialog on arrival, so
  // "Add another subscription" in the subscription panel lands on the form
  // rather than on a screen the reader has to search. See PATCHES.md.
  validateSearch: (search: Record<string, unknown>): { readonly add?: boolean } =>
    search.add === true || search.add === "true" || search.add === "1" ? { add: true } : {},
});

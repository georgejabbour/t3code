import { createFileRoute } from "@tanstack/react-router";
import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";

import { ProviderSettingsPanel } from "../components/settings/ProviderSettingsPanel";

function SettingsProvidersRoute() {
  const search = Route.useSearch();
  // `add` stays out of the panel props: the add-provider dialog reader mounted
  // inside the panel reads it from the URL itself.
  return (
    <ProviderSettingsPanel
      {...(search.environmentId ? { environmentId: search.environmentId } : {})}
      {...(search.instanceId ? { instanceId: search.instanceId } : {})}
    />
  );
}

export const Route = createFileRoute("/settings/providers")({
  validateSearch: (raw: Record<string, unknown>) => ({
    ...(typeof raw.environmentId === "string" && raw.environmentId.trim()
      ? { environmentId: EnvironmentId.make(raw.environmentId) }
      : {}),
    ...(typeof raw.instanceId === "string" && raw.instanceId.trim()
      ? { instanceId: ProviderInstanceId.make(raw.instanceId) }
      : {}),
    // Added by this fork. `?add=1` opens the add-provider dialog on arrival, so
    // "Add another subscription" in the subscription panel lands on the form
    // rather than on a screen the reader has to search. See PATCHES.md.
    ...(raw.add === true || raw.add === "true" || raw.add === "1" ? { add: true as const } : {}),
  }),
  component: SettingsProvidersRoute,
});
